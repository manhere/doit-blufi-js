对于blufi协议, 能找到的官方文档是 <https://docs.espressif.com/projects/esp-idf/zh_CN/latest/esp32c2/api-guides/ble/blufi.html#frame-formats>
其中对于一些重要信息没有描述, 需要从`ESP-IDF`源码中获取信息. 补遗如下:
1. 帧格式中的`序列号`是从0开始的, 每次发送一个新的帧, 序列号加1. 如果没有从0开始, ESP设备端会报错, 返回的type是`0x49`, 即数据帧0x18 subtype(子类型), 这个0x18 subtype在官方文档中是没有定义的.
2. BluFi的加密和校验方式是可以自定义的, 默认的加密是DH/AES128, 校验方式是CRC16, 也是ESP32-C2 官方AT固件中使用的.
2. 校验默认使用CRC-16-CCITT, 大端模式. CRC16的计算是从每一帧的第3个字符开始直到结束, 即不包括类型和帧控制. 计算时, 忽略iv8, CRC从`0取反`开始累计. CRC16的计算和赋值随时注意取值范围不要超过16bit(0xFFFF).

ESP-IDF中, 定义加密和校验函数如下:
```c
// blufi_example_main.c
static esp_blufi_callbacks_t example_callbacks = {
    .event_cb = example_event_callback,
    .negotiate_data_handler = blufi_dh_negotiate_data_handler,
    .encrypt_func = blufi_aes_encrypt,
    .decrypt_func = blufi_aes_decrypt,
    .checksum_func = blufi_crc_checksum,
};
```
ESP-IDF中, 默认加密函数如下:
```c
/*
   The SEC_TYPE_xxx is for self-defined packet data type in the procedure of "BLUFI negotiate key"
   If user use other negotiation procedure to exchange(or generate) key, should redefine the type by yourself.
 */
#define SEC_TYPE_DH_PARAM_LEN   0x00
#define SEC_TYPE_DH_PARAM_DATA  0x01
#define SEC_TYPE_DH_P           0x02
#define SEC_TYPE_DH_G           0x03
#define SEC_TYPE_DH_PUBLIC      0x04

struct blufi_security {
#define DH_SELF_PUB_KEY_LEN     128
#define DH_SELF_PUB_KEY_BIT_LEN (DH_SELF_PUB_KEY_LEN * 8)
    uint8_t  self_public_key[DH_SELF_PUB_KEY_LEN];
#define SHARE_KEY_LEN           128
#define SHARE_KEY_BIT_LEN       (SHARE_KEY_LEN * 8)
    uint8_t  share_key[SHARE_KEY_LEN];
    size_t   share_len;
#define PSK_LEN                 16
    uint8_t  psk[PSK_LEN];
    uint8_t  *dh_param;
    int      dh_param_len;
    uint8_t  iv[16];
    mbedtls_dhm_context dhm;
    mbedtls_aes_context aes;
};
static struct blufi_security *blufi_sec;

void esp_fill_random(void *buf, size_t len)
{
    assert(buf != NULL);
    uint8_t *buf_bytes = (uint8_t *)buf;
    while (len > 0) {
        uint32_t word = esp_random();
        uint32_t to_copy = MIN(sizeof(word), len);
        memcpy(buf_bytes, &word, to_copy);
        buf_bytes += to_copy;
        len -= to_copy;
    }
}

static int myrand( void *rng_state, unsigned char *output, size_t len )
{
    esp_fill_random(output, len);
    return( 0 );
}

int mbedtls_dhm_make_public(mbedtls_dhm_context *ctx, int x_size,
                            unsigned char *output, size_t olen,
                            int (*f_rng)(void *, unsigned char *, size_t),
                            void *p_rng)
{
    int ret;

    if (olen < 1 || olen > mbedtls_dhm_get_len(ctx)) {
        return MBEDTLS_ERR_DHM_BAD_INPUT_DATA;
    }

    ret = dhm_make_common(ctx, x_size, f_rng, p_rng);
    if (ret == MBEDTLS_ERR_DHM_MAKE_PARAMS_FAILED) {
        return MBEDTLS_ERR_DHM_MAKE_PUBLIC_FAILED;
    }
    if (ret != 0) {
        goto cleanup;
    }

    MBEDTLS_MPI_CHK(mbedtls_mpi_write_binary(&ctx->GX, output, olen));

cleanup:
    if (ret != 0 && ret > -128) {
        ret = MBEDTLS_ERROR_ADD(MBEDTLS_ERR_DHM_MAKE_PUBLIC_FAILED, ret);
    }
    return ret;
}

size_t mbedtls_dhm_get_len(const mbedtls_dhm_context *ctx)
{
    return mbedtls_mpi_size(&ctx->P);
}
/*
 * Parse the ServerKeyExchange parameters
 */
int mbedtls_dhm_read_params(mbedtls_dhm_context *ctx,
                            unsigned char **p,
                            const unsigned char *end)
{
    int ret = MBEDTLS_ERR_ERROR_CORRUPTION_DETECTED;

    if ((ret = dhm_read_bignum(&ctx->P,  p, end)) != 0 ||
        (ret = dhm_read_bignum(&ctx->G,  p, end)) != 0 ||
        (ret = dhm_read_bignum(&ctx->GY, p, end)) != 0) {
        return ret;
    }

    if ((ret = dhm_check_range(&ctx->GY, &ctx->P)) != 0) {
        return ret;
    }

    return 0;
}


/*
 * output = MD5( input buffer )
 */
int mbedtls_md5(const unsigned char *input,
                size_t ilen,
                unsigned char output[16])
{
    int ret = MBEDTLS_ERR_ERROR_CORRUPTION_DETECTED;
    mbedtls_md5_context ctx;

    mbedtls_md5_init(&ctx);

    if ((ret = mbedtls_md5_starts(&ctx)) != 0) {
        goto exit;
    }

    if ((ret = mbedtls_md5_update(&ctx, input, ilen)) != 0) {
        goto exit;
    }

    if ((ret = mbedtls_md5_finish(&ctx, output)) != 0) {
        goto exit;
    }

exit:
    mbedtls_md5_free(&ctx);

    return ret;
}

/*
 * AES key schedule (encryption)
 */
#if !defined(MBEDTLS_AES_SETKEY_ENC_ALT)
int mbedtls_aes_setkey_enc(mbedtls_aes_context *ctx, const unsigned char *key,
                           unsigned int keybits)
{
    uint32_t *RK;

    switch (keybits) {
        case 128: ctx->nr = 10; break;
#if !defined(MBEDTLS_AES_ONLY_128_BIT_KEY_LENGTH)
        case 192: ctx->nr = 12; break;
        case 256: ctx->nr = 14; break;
#endif /* !MBEDTLS_AES_ONLY_128_BIT_KEY_LENGTH */
        default: return MBEDTLS_ERR_AES_INVALID_KEY_LENGTH;
    }

#if !defined(MBEDTLS_AES_ROM_TABLES)
    if (aes_init_done == 0) {
        aes_gen_tables();
        aes_init_done = 1;
    }
#endif

    ctx->rk_offset = mbedtls_aes_rk_offset(ctx->buf);
    RK = ctx->buf + ctx->rk_offset;

#if defined(MBEDTLS_AESNI_HAVE_CODE)
    if (mbedtls_aesni_has_support(MBEDTLS_AESNI_AES)) {
        return mbedtls_aesni_setkey_enc((unsigned char *) RK, key, keybits);
    }
#endif

#if defined(MBEDTLS_AESCE_HAVE_CODE)
    if (MBEDTLS_AESCE_HAS_SUPPORT()) {
        return mbedtls_aesce_setkey_enc((unsigned char *) RK, key, keybits);
    }
#endif

#if !defined(MBEDTLS_AES_USE_HARDWARE_ONLY)
    for (unsigned int i = 0; i < (keybits >> 5); i++) {
        RK[i] = MBEDTLS_GET_UINT32_LE(key, i << 2);
    }

    switch (ctx->nr) {
        case 10:

            for (unsigned int i = 0; i < 10; i++, RK += 4) {
                RK[4]  = RK[0] ^ round_constants[i] ^
                         ((uint32_t) FSb[MBEDTLS_BYTE_1(RK[3])]) ^
                         ((uint32_t) FSb[MBEDTLS_BYTE_2(RK[3])] <<  8) ^
                         ((uint32_t) FSb[MBEDTLS_BYTE_3(RK[3])] << 16) ^
                         ((uint32_t) FSb[MBEDTLS_BYTE_0(RK[3])] << 24);

                RK[5]  = RK[1] ^ RK[4];
                RK[6]  = RK[2] ^ RK[5];
                RK[7]  = RK[3] ^ RK[6];
            }
            break;

#if !defined(MBEDTLS_AES_ONLY_128_BIT_KEY_LENGTH)
        case 12:

            for (unsigned int i = 0; i < 8; i++, RK += 6) {
                RK[6]  = RK[0] ^ round_constants[i] ^
                         ((uint32_t) FSb[MBEDTLS_BYTE_1(RK[5])]) ^
                         ((uint32_t) FSb[MBEDTLS_BYTE_2(RK[5])] <<  8) ^
                         ((uint32_t) FSb[MBEDTLS_BYTE_3(RK[5])] << 16) ^
                         ((uint32_t) FSb[MBEDTLS_BYTE_0(RK[5])] << 24);

                RK[7]  = RK[1] ^ RK[6];
                RK[8]  = RK[2] ^ RK[7];
                RK[9]  = RK[3] ^ RK[8];
                RK[10] = RK[4] ^ RK[9];
                RK[11] = RK[5] ^ RK[10];
            }
            break;

        case 14:

            for (unsigned int i = 0; i < 7; i++, RK += 8) {
                RK[8]  = RK[0] ^ round_constants[i] ^
                         ((uint32_t) FSb[MBEDTLS_BYTE_1(RK[7])]) ^
                         ((uint32_t) FSb[MBEDTLS_BYTE_2(RK[7])] <<  8) ^
                         ((uint32_t) FSb[MBEDTLS_BYTE_3(RK[7])] << 16) ^
                         ((uint32_t) FSb[MBEDTLS_BYTE_0(RK[7])] << 24);

                RK[9]  = RK[1] ^ RK[8];
                RK[10] = RK[2] ^ RK[9];
                RK[11] = RK[3] ^ RK[10];

                RK[12] = RK[4] ^
                         ((uint32_t) FSb[MBEDTLS_BYTE_0(RK[11])]) ^
                         ((uint32_t) FSb[MBEDTLS_BYTE_1(RK[11])] <<  8) ^
                         ((uint32_t) FSb[MBEDTLS_BYTE_2(RK[11])] << 16) ^
                         ((uint32_t) FSb[MBEDTLS_BYTE_3(RK[11])] << 24);

                RK[13] = RK[5] ^ RK[12];
                RK[14] = RK[6] ^ RK[13];
                RK[15] = RK[7] ^ RK[14];
            }
            break;
#endif /* !MBEDTLS_AES_ONLY_128_BIT_KEY_LENGTH */
    }

    return 0;
#endif /* !MBEDTLS_AES_USE_HARDWARE_ONLY */
}
#endif /* !MBEDTLS_AES_SETKEY_ENC_ALT */

void blufi_dh_negotiate_data_handler(uint8_t *data, int len, uint8_t **output_data, int *output_len, bool *need_free)
{
    int ret;
    uint8_t type = data[0];

    if (blufi_sec == NULL) {
        BLUFI_ERROR("BLUFI Security is not initialized");
        btc_blufi_report_error(ESP_BLUFI_INIT_SECURITY_ERROR);
        return;
    }

    switch (type) {
    case SEC_TYPE_DH_PARAM_LEN:
        blufi_sec->dh_param_len = ((data[1]<<8)|data[2]);
        if (blufi_sec->dh_param) {
            free(blufi_sec->dh_param);
            blufi_sec->dh_param = NULL;
        }
        blufi_sec->dh_param = (uint8_t *)malloc(blufi_sec->dh_param_len);
        if (blufi_sec->dh_param == NULL) {
            btc_blufi_report_error(ESP_BLUFI_DH_MALLOC_ERROR);
            BLUFI_ERROR("%s, malloc failed\n", __func__);
            return;
        }
        break;
    case SEC_TYPE_DH_PARAM_DATA:{
        if (blufi_sec->dh_param == NULL) {
            BLUFI_ERROR("%s, blufi_sec->dh_param == NULL\n", __func__);
            btc_blufi_report_error(ESP_BLUFI_DH_PARAM_ERROR);
            return;
        }
        uint8_t *param = blufi_sec->dh_param;
        memcpy(blufi_sec->dh_param, &data[1], blufi_sec->dh_param_len);
        ret = mbedtls_dhm_read_params(&blufi_sec->dhm, &param, &param[blufi_sec->dh_param_len]);
        if (ret) {
            BLUFI_ERROR("%s read param failed %d\n", __func__, ret);
            btc_blufi_report_error(ESP_BLUFI_READ_PARAM_ERROR);
            return;
        }
        free(blufi_sec->dh_param);
        blufi_sec->dh_param = NULL;

        const int dhm_len = mbedtls_dhm_get_len(&blufi_sec->dhm);
        ret = mbedtls_dhm_make_public(&blufi_sec->dhm, dhm_len, blufi_sec->self_public_key, dhm_len, myrand, NULL);
        if (ret) {
            BLUFI_ERROR("%s make public failed %d\n", __func__, ret);
            btc_blufi_report_error(ESP_BLUFI_MAKE_PUBLIC_ERROR);
            return;
        }

        ret = mbedtls_dhm_calc_secret( &blufi_sec->dhm,
                blufi_sec->share_key,
                SHARE_KEY_BIT_LEN,
                &blufi_sec->share_len,
                myrand, NULL);
        if (ret) {
            BLUFI_ERROR("%s mbedtls_dhm_calc_secret failed %d\n", __func__, ret);
            btc_blufi_report_error(ESP_BLUFI_DH_PARAM_ERROR);
            return;
        }

        ret = mbedtls_md5(blufi_sec->share_key, blufi_sec->share_len, blufi_sec->psk);

        if (ret) {
            BLUFI_ERROR("%s mbedtls_md5 failed %d\n", __func__, ret);
            btc_blufi_report_error(ESP_BLUFI_CALC_MD5_ERROR);
            return;
        }

        mbedtls_aes_setkey_enc(&blufi_sec->aes, blufi_sec->psk, 128);

        /* alloc output data */
        *output_data = &blufi_sec->self_public_key[0];
        *output_len = dhm_len;
        *need_free = false;

    }
        break;
    case SEC_TYPE_DH_P:
        break;
    case SEC_TYPE_DH_G:
        break;
    case SEC_TYPE_DH_PUBLIC:
        break;
    }
}

int blufi_aes_encrypt(uint8_t iv8, uint8_t *crypt_data, int crypt_len)
{
    int ret;
    size_t iv_offset = 0;
    uint8_t iv0[16];

    memcpy(iv0, blufi_sec->iv, sizeof(blufi_sec->iv));
    iv0[0] = iv8;   /* set iv8 as the iv0[0] */

    ret = mbedtls_aes_crypt_cfb128(&blufi_sec->aes, MBEDTLS_AES_ENCRYPT, crypt_len, &iv_offset, iv0, crypt_data, crypt_data);
    if (ret) {
        return -1;
    }

    return crypt_len;
}

int blufi_aes_decrypt(uint8_t iv8, uint8_t *crypt_data, int crypt_len)
{
    int ret;
    size_t iv_offset = 0;
    uint8_t iv0[16];

    memcpy(iv0, blufi_sec->iv, sizeof(blufi_sec->iv));
    iv0[0] = iv8;   /* set iv8 as the iv0[0] */

    ret = mbedtls_aes_crypt_cfb128(&blufi_sec->aes, MBEDTLS_AES_DECRYPT, crypt_len, &iv_offset, iv0, crypt_data, crypt_data);
    if (ret) {
        return -1;
    }

    return crypt_len;
}
```

ESP-IDF中使用的CRC16的计算函数如下:
```c

static uint16_t crc16_be_table[256] = {
    0x0000, 0x1021, 0x2042, 0x3063, 0x4084, 0x50a5, 0x60c6, 0x70e7, 0x8108, 0x9129,0xa14a, 0xb16b, 0xc18c, 0xd1ad, 0xe1ce, 0xf1ef,
    0x1231, 0x0210, 0x3273, 0x2252, 0x52b5, 0x4294, 0x72f7, 0x62d6, 0x9339, 0x8318,0xb37b, 0xa35a, 0xd3bd, 0xc39c, 0xf3ff, 0xe3de,
    0x2462, 0x3443, 0x0420, 0x1401, 0x64e6, 0x74c7, 0x44a4, 0x5485, 0xa56a, 0xb54b,0x8528, 0x9509, 0xe5ee, 0xf5cf, 0xc5ac, 0xd58d,
    0x3653, 0x2672, 0x1611, 0x0630, 0x76d7, 0x66f6, 0x5695, 0x46b4, 0xb75b, 0xa77a,0x9719, 0x8738, 0xf7df, 0xe7fe, 0xd79d, 0xc7bc,
    0x48c4, 0x58e5, 0x6886, 0x78a7, 0x0840, 0x1861, 0x2802, 0x3823, 0xc9cc, 0xd9ed,0xe98e, 0xf9af, 0x8948, 0x9969, 0xa90a, 0xb92b,
    0x5af5, 0x4ad4, 0x7ab7, 0x6a96, 0x1a71, 0x0a50, 0x3a33, 0x2a12, 0xdbfd, 0xcbdc,0xfbbf, 0xeb9e, 0x9b79, 0x8b58, 0xbb3b, 0xab1a,
    0x6ca6, 0x7c87, 0x4ce4, 0x5cc5, 0x2c22, 0x3c03, 0x0c60, 0x1c41, 0xedae, 0xfd8f,0xcdec, 0xddcd, 0xad2a, 0xbd0b, 0x8d68, 0x9d49,
    0x7e97, 0x6eb6, 0x5ed5, 0x4ef4, 0x3e13, 0x2e32, 0x1e51, 0x0e70, 0xff9f, 0xefbe,0xdfdd, 0xcffc, 0xbf1b, 0xaf3a, 0x9f59, 0x8f78,
    0x9188, 0x81a9, 0xb1ca, 0xa1eb, 0xd10c, 0xc12d, 0xf14e, 0xe16f, 0x1080, 0x00a1,0x30c2, 0x20e3, 0x5004, 0x4025, 0x7046, 0x6067,
    0x83b9, 0x9398, 0xa3fb, 0xb3da, 0xc33d, 0xd31c, 0xe37f, 0xf35e, 0x02b1, 0x1290,0x22f3, 0x32d2, 0x4235, 0x5214, 0x6277, 0x7256,
    0xb5ea, 0xa5cb, 0x95a8, 0x8589, 0xf56e, 0xe54f, 0xd52c, 0xc50d, 0x34e2, 0x24c3,0x14a0, 0x0481, 0x7466, 0x6447, 0x5424, 0x4405,
    0xa7db, 0xb7fa, 0x8799, 0x97b8, 0xe75f, 0xf77e, 0xc71d, 0xd73c, 0x26d3, 0x36f2,0x0691, 0x16b0, 0x6657, 0x7676, 0x4615, 0x5634,
    0xd94c, 0xc96d, 0xf90e, 0xe92f, 0x99c8, 0x89e9, 0xb98a, 0xa9ab, 0x5844, 0x4865,0x7806, 0x6827, 0x18c0, 0x08e1, 0x3882, 0x28a3,
    0xcb7d, 0xdb5c, 0xeb3f, 0xfb1e, 0x8bf9, 0x9bd8, 0xabbb, 0xbb9a, 0x4a75, 0x5a54,0x6a37, 0x7a16, 0x0af1, 0x1ad0, 0x2ab3, 0x3a92,
    0xfd2e, 0xed0f, 0xdd6c, 0xcd4d, 0xbdaa, 0xad8b, 0x9de8, 0x8dc9, 0x7c26, 0x6c07,0x5c64, 0x4c45, 0x3ca2, 0x2c83, 0x1ce0, 0x0cc1,
    0xef1f, 0xff3e, 0xcf5d, 0xdf7c, 0xaf9b, 0xbfba, 0x8fd9, 0x9ff8, 0x6e17, 0x7e36,0x4e55, 0x5e74, 0x2e93, 0x3eb2, 0x0ed1, 0x1ef0
};


uint16_t esp_rom_crc16_be(uint16_t crc, uint8_t const *buf, uint32_t len){
    unsigned int i;
    crc = ~crc;
    for (i = 0; i < len; i++) {
        crc = crc16_be_table[(crc >> 8)^buf[i]] ^ (crc << 8);
    }
    return ~crc;
}

uint16_t esp_crc16_be(uint16_t crc, uint8_t const *buf, uint32_t len){
    return esp_rom_crc16_be(crc, buf, len);
}

uint16_t blufi_crc_checksum(uint8_t iv8, uint8_t *data, int len){
    /* This iv8 ignore, not used */
    return esp_crc16_be(0, data, len);
}
```

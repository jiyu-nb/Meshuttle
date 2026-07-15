package cn.jiyu.meshuttle;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class SecretStore {
    static final class Config {
        final String serverUrl;
        final String accessToken;

        Config(String serverUrl, String accessToken) {
            this.serverUrl = serverUrl;
            this.accessToken = accessToken;
        }
    }

    private static final String KEY_ALIAS = "meshuttle_access_token";
    private static final String PREFS = "meshuttle_secure_config";
    private static final String SERVER_URL = "server_url";
    private static final String TOKEN = "access_token";
    private final SharedPreferences preferences;

    SecretStore(Context context) {
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    Config load() {
        String serverUrl = preferences.getString(SERVER_URL, "");
        String encrypted = preferences.getString(TOKEN, "");
        if (serverUrl == null || serverUrl.trim().isEmpty() || encrypted == null || encrypted.trim().isEmpty()) return null;
        try {
            return new Config(serverUrl, decrypt(encrypted));
        } catch (Exception error) {
            clear();
            return null;
        }
    }

    void save(Config config) throws Exception {
        preferences.edit()
            .putString(SERVER_URL, config.serverUrl)
            .putString(TOKEN, encrypt(config.accessToken))
            .apply();
    }

    void clear() {
        preferences.edit().clear().apply();
    }

    private String encrypt(String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        byte[] payload = new byte[cipher.getIV().length + encrypted.length];
        System.arraycopy(cipher.getIV(), 0, payload, 0, cipher.getIV().length);
        System.arraycopy(encrypted, 0, payload, cipher.getIV().length, encrypted.length);
        return Base64.encodeToString(payload, Base64.NO_WRAP);
    }

    private String decrypt(String encoded) throws Exception {
        byte[] payload = Base64.decode(encoded, Base64.NO_WRAP);
        if (payload.length < 13) throw new IllegalArgumentException("Invalid encrypted token");
        byte[] iv = new byte[12];
        byte[] encrypted = new byte[payload.length - iv.length];
        System.arraycopy(payload, 0, iv, 0, iv.length);
        System.arraycopy(payload, iv.length, encrypted, 0, encrypted.length);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return (SecretKey) store.getKey(KEY_ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build());
        return generator.generateKey();
    }
}

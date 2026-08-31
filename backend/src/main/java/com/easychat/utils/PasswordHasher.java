package com.easychat.utils;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;

/** PBKDF2 password and opaque access-token primitives. */
public final class PasswordHasher {
    private static final String ALGORITHM = "PBKDF2WithHmacSHA256";
    private static final int ITERATIONS = 310000;
    private static final SecureRandom RANDOM = new SecureRandom();

    private PasswordHasher() {}

    public static String hash(String password) {
        byte[] salt = new byte[16];
        RANDOM.nextBytes(salt);
        byte[] derived = derive(password.toCharArray(), salt, ITERATIONS, 32);
        Base64.Encoder encoder = Base64.getUrlEncoder().withoutPadding();
        return "pbkdf2-sha256$v1$" + ITERATIONS + "$" + encoder.encodeToString(salt) + "$" + encoder.encodeToString(derived);
    }

    public static boolean matches(String password, String encoded) {
        try {
            String[] parts = encoded == null ? new String[0] : encoded.split("\\$", -1);
            if (parts.length != 5 || !"pbkdf2-sha256".equals(parts[0]) || !"v1".equals(parts[1])) return false;
            int iterations = Integer.parseInt(parts[2]);
            if (iterations < 100000 || iterations > 1000000) return false;
            Base64.Decoder decoder = Base64.getUrlDecoder();
            byte[] expected = decoder.decode(parts[4]);
            byte[] actual = derive(password.toCharArray(), decoder.decode(parts[3]), iterations, expected.length);
            return MessageDigest.isEqual(expected, actual);
        } catch (Exception ignored) {
            return false;
        }
    }

    public static String newAccessToken() {
        byte[] value = new byte[32];
        RANDOM.nextBytes(value);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
    }

    public static String tokenKey(String token) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }

    private static byte[] derive(char[] password, byte[] salt, int iterations, int size) {
        PBEKeySpec spec = new PBEKeySpec(password, salt, iterations, size * 8);
        try {
            return SecretKeyFactory.getInstance(ALGORITHM).generateSecret(spec).getEncoded();
        } catch (Exception e) {
            throw new IllegalStateException("PBKDF2 is unavailable", e);
        } finally {
            spec.clearPassword();
        }
    }
}

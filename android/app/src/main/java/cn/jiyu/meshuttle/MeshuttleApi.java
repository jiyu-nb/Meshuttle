package cn.jiyu.meshuttle;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

final class MeshuttleApi {
    static final class ItemPage {
        final List<MeshuttleItem> items;
        final double retentionHours;

        ItemPage(List<MeshuttleItem> items, double retentionHours) {
            this.items = items;
            this.retentionHours = retentionHours;
        }
    }

    static final class UploadInfo {
        final String name;
        final long size;

        UploadInfo(String name, long size) {
            this.name = name;
            this.size = size;
        }
    }

    private static final int JSON_LIMIT = 5 * 1024 * 1024;
    private final String baseUrl;
    private final String accessToken;

    MeshuttleApi(String baseUrl, String accessToken) {
        String normalized = baseUrl == null ? "" : baseUrl.trim();
        while (normalized.endsWith("/")) normalized = normalized.substring(0, normalized.length() - 1);
        this.baseUrl = normalized;
        this.accessToken = accessToken == null ? "" : accessToken;
    }

    static void validateConfig(String serverUrl, String accessToken) {
        try {
            URI uri = URI.create(serverUrl == null ? "" : serverUrl.trim());
            if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme())) || uri.getHost() == null) {
                throw new IllegalArgumentException("服务器地址必须以 http:// 或 https:// 开头");
            }
        } catch (RuntimeException error) {
            throw new IllegalArgumentException("服务器地址格式无效");
        }
        if (accessToken == null || accessToken.trim().length() < 24) throw new IllegalArgumentException("访问码至少需要 24 位");
    }

    ItemPage listItems() throws Exception {
        JSONObject result = requestJson("GET", "/api/items", null);
        JSONArray values = result.optJSONArray("items");
        List<MeshuttleItem> items = new ArrayList<>();
        if (values != null) for (int index = 0; index < values.length(); index++) items.add(MeshuttleItem.fromJson(values.getJSONObject(index)));
        return new ItemPage(items, result.optDouble("retentionHours", 72));
    }

    void createText(String text) throws Exception {
        JSONObject body = new JSONObject().put("text", text == null ? "" : text.trim());
        requestJson("POST", "/api/text", body.toString().getBytes(StandardCharsets.UTF_8));
    }

    void deleteItem(String id) throws Exception {
        requestJson("DELETE", "/api/items/" + id, null);
    }

    UploadInfo upload(Context context, Uri uri) throws Exception {
        ContentResolver resolver = context.getContentResolver();
        String name = displayName(resolver, uri);
        long size = displaySize(resolver, uri);
        File temporary = null;
        InputStream source;
        if (size >= 0) {
            source = resolver.openInputStream(uri);
        } else {
            temporary = File.createTempFile("meshuttle-upload-", ".bin", context.getCacheDir());
            try (InputStream input = resolver.openInputStream(uri); OutputStream output = new FileOutputStream(temporary)) {
                if (input == null) throw new IOException("无法读取所选文件");
                copy(input, output);
            }
            size = temporary.length();
            source = new FileInputStream(temporary);
        }
        if (source == null) throw new IOException("无法读取所选文件");

        HttpURLConnection connection = open("POST", "/api/files", 30 * 60_000);
        connection.setRequestProperty("Content-Type", resolver.getType(uri) == null ? "application/octet-stream" : resolver.getType(uri));
        connection.setRequestProperty("X-File-Name-B64", Base64.encodeToString(name.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP));
        connection.setFixedLengthStreamingMode(size);
        connection.setDoOutput(true);
        try (InputStream input = source; OutputStream output = new BufferedOutputStream(connection.getOutputStream())) {
            copy(input, output);
        } finally {
            if (temporary != null) temporary.delete();
        }
        ensureSuccess(connection);
        connection.disconnect();
        return new UploadInfo(name, size);
    }

    void download(MeshuttleItem item, OutputStream destination) throws Exception {
        HttpURLConnection connection = open("GET", "/api/files/" + item.id, 30 * 60_000);
        try {
            ensureStatus(connection);
            try (InputStream input = new BufferedInputStream(connection.getInputStream()); OutputStream output = new BufferedOutputStream(destination)) {
                copy(input, output);
            }
        } finally {
            connection.disconnect();
        }
    }

    private JSONObject requestJson(String method, String route, byte[] body) throws Exception {
        HttpURLConnection connection = open(method, route, 30_000);
        try {
            if (body != null) {
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setFixedLengthStreamingMode(body.length);
                connection.setDoOutput(true);
                try (OutputStream output = connection.getOutputStream()) { output.write(body); }
            }
            ensureStatus(connection);
            byte[] response = readLimited(connection.getInputStream(), JSON_LIMIT);
            return response.length == 0 ? new JSONObject() : new JSONObject(new String(response, StandardCharsets.UTF_8));
        } finally {
            connection.disconnect();
        }
    }

    private HttpURLConnection open(String method, String route, int timeout) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(baseUrl + route).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(timeout);
        connection.setRequestProperty("Authorization", "Bearer " + accessToken);
        connection.setRequestProperty("Accept", "application/json");
        connection.setUseCaches(false);
        return connection;
    }

    private static void ensureSuccess(HttpURLConnection connection) throws Exception {
        ensureStatus(connection);
        InputStream input = connection.getInputStream();
        if (input != null) input.close();
    }

    private static void ensureStatus(HttpURLConnection connection) throws Exception {
        int status = connection.getResponseCode();
        if (status >= 200 && status < 300) return;
        InputStream error = connection.getErrorStream();
        String message = "服务器返回 " + status;
        if (error != null) {
            try {
                String body = new String(readLimited(error, JSON_LIMIT), StandardCharsets.UTF_8);
                JSONObject parsed = new JSONObject(body);
                message = parsed.optString("error", message);
            } catch (Exception ignored) {
                // Keep the HTTP status fallback.
            }
        }
        throw new IOException(message);
    }

    private static byte[] readLimited(InputStream input, int limit) throws IOException {
        try (InputStream source = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16 * 1024];
            int total = 0;
            int count;
            while ((count = source.read(buffer)) >= 0) {
                total += count;
                if (total > limit) throw new IOException("服务器响应过大");
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }

    private static void copy(InputStream input, OutputStream output) throws IOException {
        byte[] buffer = new byte[64 * 1024];
        int count;
        while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
    }

    private static String displayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String value = cursor.getString(0);
                if (value != null && !value.trim().isEmpty()) return sanitizeName(value);
            }
        }
        String fallback = uri.getLastPathSegment();
        return sanitizeName(fallback == null ? "upload" : fallback);
    }

    private static long displaySize(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[]{OpenableColumns.SIZE}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) return cursor.getLong(0);
        }
        return -1;
    }

    private static String sanitizeName(String value) {
        String clean = value.replaceAll("[\\x00-\\x1f\\\\/]", "_").trim();
        return clean.isEmpty() ? "upload" : (clean.length() > 200 ? clean.substring(0, 200) : clean);
    }
}

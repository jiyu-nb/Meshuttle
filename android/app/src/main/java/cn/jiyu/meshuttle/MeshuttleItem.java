package cn.jiyu.meshuttle;

import org.json.JSONObject;

final class MeshuttleItem {
    final String id;
    final String type;
    final String text;
    final String name;
    final long size;
    final String contentType;
    final String createdAt;
    final String expiresAt;

    private MeshuttleItem(String id, String type, String text, String name, long size,
                          String contentType, String createdAt, String expiresAt) {
        this.id = id;
        this.type = type;
        this.text = text;
        this.name = name;
        this.size = size;
        this.contentType = contentType;
        this.createdAt = createdAt;
        this.expiresAt = expiresAt;
    }

    static MeshuttleItem fromJson(JSONObject value) {
        return new MeshuttleItem(
            value.optString("id"),
            value.optString("type"),
            value.optString("text"),
            value.optString("name"),
            value.optLong("size", 0),
            value.optString("contentType", "application/octet-stream"),
            value.optString("createdAt"),
            value.optString("expiresAt")
        );
    }

    boolean isFile() {
        return "file".equals(type);
    }
}

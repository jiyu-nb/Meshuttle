package cn.jiyu.meshuttle;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.DocumentsContract;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.OutputStream;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int REQUEST_FILES = 1001;
    private static final int REQUEST_DOWNLOAD_FOLDER = 1002;
    private static final int BG = Color.rgb(11, 13, 16);
    private static final int SURFACE = Color.rgb(21, 25, 30);
    private static final int SURFACE_ALT = Color.rgb(27, 32, 39);
    private static final int LINE = Color.rgb(48, 56, 66);
    private static final int TEXT = Color.rgb(237, 241, 245);
    private static final int MUTED = Color.rgb(154, 164, 175);
    private static final int AMBER = Color.rgb(244, 185, 66);
    private static final int TEAL = Color.rgb(65, 211, 189);
    private static final int DANGER = Color.rgb(240, 106, 99);

    private final ExecutorService io = Executors.newFixedThreadPool(3);
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Set<String> selectedIds = new HashSet<>();
    private final List<MeshuttleItem> currentItems = new ArrayList<>();
    private final Runnable refreshLoop = new Runnable() {
        @Override public void run() {
            if (inboxVisible) refreshItems(true);
            main.postDelayed(this, 6_000);
        }
    };

    private FrameLayout contentFrame;
    private SecretStore secretStore;
    private SecretStore.Config config;
    private MeshuttleApi api;
    private LinearLayout itemsContainer;
    private TextView itemCount;
    private TextView selectionText;
    private TextView connectionStatus;
    private TextView retentionText;
    private TextView progressText;
    private ProgressBar progressBar;
    private EditText textComposer;
    private Button selectAllButton;
    private Button downloadSelectedButton;
    private Button deleteSelectedButton;
    private Button refreshButton;
    private boolean inboxVisible;
    private boolean refreshing;
    private List<MeshuttleItem> pendingDownloads = Collections.emptyList();

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        secretStore = new SecretStore(this);
        config = secretStore.load();
        contentFrame = new FrameLayout(this);
        contentFrame.setBackgroundColor(BG);
        setContentView(contentFrame);
        if (config == null) showSetup();
        else showInbox();
    }

    @Override protected void onResume() {
        super.onResume();
        main.removeCallbacks(refreshLoop);
        main.postDelayed(refreshLoop, 6_000);
    }

    @Override protected void onPause() {
        main.removeCallbacks(refreshLoop);
        super.onPause();
    }

    @Override protected void onDestroy() {
        main.removeCallbacksAndMessages(null);
        io.shutdownNow();
        super.onDestroy();
    }

    @Override @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (resultCode != RESULT_OK || data == null) return;
        if (requestCode == REQUEST_FILES) {
            List<Uri> values = new ArrayList<>();
            ClipData clips = data.getClipData();
            if (clips != null) for (int index = 0; index < clips.getItemCount(); index++) values.add(clips.getItemAt(index).getUri());
            else if (data.getData() != null) values.add(data.getData());
            if (!values.isEmpty()) uploadFiles(values);
        } else if (requestCode == REQUEST_DOWNLOAD_FOLDER && data.getData() != null) {
            Uri tree = data.getData();
            try {
                getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (SecurityException ignored) {
                // Some providers grant access only for the current operation.
            }
            downloadItemsTo(tree, pendingDownloads);
        }
    }

    private void showSetup() {
        inboxVisible = false;
        contentFrame.removeAllViews();
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout body = column();
        body.setPadding(dp(24), dp(28), dp(24), dp(36));
        scroll.addView(body, matchWrap());

        TextView eyebrow = label("MESHUTTLE · ANDROID 1.1.0", 11, AMBER, true);
        eyebrow.setLetterSpacing(.14f);
        body.addView(eyebrow);
        TextView brand = label("织梭", 34, TEXT, true);
        body.addView(brand, margins(matchWrap(), 0, 8, 0, 0));
        body.addView(label("把手机连接到自己的服务器或局域网托管电脑。访问码只会以 Android Keystore 加密形式保存在本机。", 14, MUTED, false), margins(matchWrap(), 0, 10, 0, 24));

        LinearLayout card = card();
        body.addView(card, matchWrap());
        card.addView(label("连接服务器", 20, TEXT, true));
        card.addView(label("公网请使用 HTTPS；同一局域网可填写电脑显示的 HTTP 地址。", 13, MUTED, false), margins(matchWrap(), 0, 6, 0, 18));

        card.addView(label("服务器地址", 12, MUTED, true));
        EditText serverInput = input("https://meshuttle.example.com");
        serverInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        if (config != null) serverInput.setText(config.serverUrl);
        card.addView(serverInput, margins(matchWrap(), 0, 6, 0, 14));

        card.addView(label("访问码", 12, MUTED, true));
        EditText tokenInput = input("至少 24 位访问码");
        tokenInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        if (config != null) tokenInput.setText(config.accessToken);
        card.addView(tokenInput, margins(matchWrap(), 0, 6, 0, 16));

        TextView setupStatus = label("", 13, MUTED, false);
        setupStatus.setVisibility(View.GONE);
        card.addView(setupStatus, margins(matchWrap(), 0, 0, 0, 12));
        Button save = button("验证并保存连接", true);
        save.setOnClickListener(view -> {
            String server = serverInput.getText().toString().trim();
            String token = tokenInput.getText().toString().trim();
            try { MeshuttleApi.validateConfig(server, token); }
            catch (Exception error) { showInline(setupStatus, error.getMessage(), true); return; }
            save.setEnabled(false);
            save.setText("正在验证…");
            showInline(setupStatus, "正在连接服务器并验证访问码…", false);
            MeshuttleApi candidate = new MeshuttleApi(server, token);
            runTask(candidate::listItems, ignored -> {
                try {
                    config = new SecretStore.Config(server.replaceAll("/+$", ""), token);
                    secretStore.save(config);
                    api = candidate;
                    hideKeyboard();
                    showInbox();
                } catch (Exception error) {
                    save.setEnabled(true);
                    save.setText("验证并保存连接");
                    showInline(setupStatus, message(error), true);
                }
            }, error -> {
                save.setEnabled(true);
                save.setText("验证并保存连接");
                showInline(setupStatus, message(error), true);
            });
        });
        card.addView(save, matchWrap());

        Button licenses = button("开源许可与隐私说明", false);
        licenses.setOnClickListener(view -> showLicenses());
        body.addView(licenses, margins(matchWrap(), 0, 16, 0, 0));
        contentFrame.addView(scroll, matchMatch());
    }

    private void showInbox() {
        inboxVisible = true;
        if (config == null) { showSetup(); return; }
        api = new MeshuttleApi(config.serverUrl, config.accessToken);
        contentFrame.removeAllViews();

        LinearLayout screen = column();
        screen.setBackgroundColor(BG);
        LinearLayout header = row();
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(20), dp(17), dp(14), dp(15));
        header.setBackgroundColor(Color.rgb(16, 19, 24));
        LinearLayout titleBox = column();
        titleBox.addView(label("织梭", 22, TEXT, true));
        titleBox.addView(label("Meshuttle · Android 1.1.0", 10, MUTED, false));
        header.addView(titleBox, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        connectionStatus = label("正在连接", 11, AMBER, true);
        header.addView(connectionStatus, margins(wrapWrap(), 8, 0, 8, 0));
        Button settings = button("设置", false);
        settings.setOnClickListener(view -> showSetup());
        header.addView(settings, new LinearLayout.LayoutParams(dp(72), dp(40)));
        screen.addView(header, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        ScrollView scroll = new ScrollView(this);
        LinearLayout body = column();
        body.setPadding(dp(16), dp(18), dp(16), dp(36));
        scroll.addView(body, matchWrap());

        LinearLayout composerCard = card();
        composerCard.addView(label("发送文字或文件", 18, TEXT, true));
        retentionText = label("正在读取留存时长", 12, MUTED, false);
        composerCard.addView(retentionText, margins(matchWrap(), 0, 5, 0, 14));
        textComposer = input("输入或粘贴文字");
        textComposer.setSingleLine(false);
        textComposer.setGravity(Gravity.TOP);
        textComposer.setMinLines(3);
        textComposer.setMaxLines(7);
        textComposer.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        composerCard.addView(textComposer, matchWrap());
        LinearLayout composerActions = row();
        Button send = button("发送文字", true);
        send.setOnClickListener(view -> sendText(send));
        Button choose = button("选择多个文件", false);
        choose.setOnClickListener(view -> chooseFiles());
        composerActions.addView(send, new LinearLayout.LayoutParams(0, dp(44), 1));
        composerActions.addView(choose, margins(new LinearLayout.LayoutParams(0, dp(44), 1), 8, 0, 0, 0));
        composerCard.addView(composerActions, margins(matchWrap(), 0, 12, 0, 0));
        body.addView(composerCard, matchWrap());

        LinearLayout batchCard = card();
        selectionText = label("尚未选择内容", 12, MUTED, false);
        batchCard.addView(selectionText);
        LinearLayout batchRow1 = row();
        selectAllButton = button("全选", false);
        selectAllButton.setOnClickListener(view -> toggleSelectAll());
        downloadSelectedButton = button("下载所选文件", false);
        downloadSelectedButton.setOnClickListener(view -> beginSelectedDownloads());
        batchRow1.addView(selectAllButton, new LinearLayout.LayoutParams(0, dp(42), 1));
        batchRow1.addView(downloadSelectedButton, margins(new LinearLayout.LayoutParams(0, dp(42), 1), 8, 0, 0, 0));
        batchCard.addView(batchRow1, margins(matchWrap(), 0, 10, 0, 0));
        LinearLayout batchRow2 = row();
        deleteSelectedButton = button("删除所选", false);
        deleteSelectedButton.setTextColor(DANGER);
        deleteSelectedButton.setOnClickListener(view -> confirmDelete(selectedItems(), "删除所选内容"));
        refreshButton = button("刷新列表", false);
        refreshButton.setOnClickListener(view -> refreshItems(false));
        batchRow2.addView(deleteSelectedButton, new LinearLayout.LayoutParams(0, dp(42), 1));
        batchRow2.addView(refreshButton, margins(new LinearLayout.LayoutParams(0, dp(42), 1), 8, 0, 0, 0));
        batchCard.addView(batchRow2, margins(matchWrap(), 0, 8, 0, 0));
        body.addView(batchCard, margins(matchWrap(), 0, 12, 0, 0));

        LinearLayout progressRow = row();
        progressRow.setGravity(Gravity.CENTER_VERTICAL);
        progressBar = new ProgressBar(this);
        progressBar.setIndeterminate(true);
        progressBar.getIndeterminateDrawable().setTint(AMBER);
        progressText = label("", 12, MUTED, false);
        progressRow.addView(progressBar, new LinearLayout.LayoutParams(dp(28), dp(28)));
        progressRow.addView(progressText, margins(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1), 8, 0, 0, 0));
        progressRow.setVisibility(View.GONE);
        progressRow.setTag("progress-row");
        body.addView(progressRow, margins(matchWrap(), 0, 4, 0, 12));

        LinearLayout sectionTitle = row();
        sectionTitle.setGravity(Gravity.CENTER_VERTICAL);
        sectionTitle.addView(label("最近投递", 18, TEXT, true), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        itemCount = label("正在加载", 12, MUTED, false);
        sectionTitle.addView(itemCount);
        body.addView(sectionTitle, margins(matchWrap(), 0, 8, 0, 10));
        itemsContainer = column();
        body.addView(itemsContainer, matchWrap());

        screen.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        contentFrame.addView(screen, matchMatch());
        updateBatchControls();
        refreshItems(false);
    }

    private void refreshItems(boolean silent) {
        if (refreshing || api == null) return;
        refreshing = true;
        if (refreshButton != null) refreshButton.setEnabled(false);
        runTask(api::listItems, page -> {
            refreshing = false;
            if (refreshButton != null) refreshButton.setEnabled(true);
            currentItems.clear();
            currentItems.addAll(page.items);
            Set<String> validIds = new HashSet<>();
            for (MeshuttleItem item : currentItems) validIds.add(item.id);
            selectedIds.retainAll(validIds);
            setConnection(true, "已连接");
            retentionText.setText("内容将在 " + formatRetention(page.retentionHours) + " 后自动清理");
            renderItems();
        }, error -> {
            refreshing = false;
            if (refreshButton != null) refreshButton.setEnabled(true);
            setConnection(false, "连接失败");
            if (!silent) toast(message(error));
        });
    }

    private void renderItems() {
        if (itemsContainer == null) return;
        itemsContainer.removeAllViews();
        itemCount.setText("共 " + currentItems.size() + " 项");
        if (currentItems.isEmpty()) {
            LinearLayout empty = card();
            empty.setGravity(Gravity.CENTER_HORIZONTAL);
            empty.addView(label("投递箱还是空的", 17, TEXT, true));
            empty.addView(label("先发送一段文字，或从手机选择文件。", 13, MUTED, false), margins(matchWrap(), 0, 7, 0, 0));
            itemsContainer.addView(empty, matchWrap());
        }
        for (MeshuttleItem item : currentItems) itemsContainer.addView(itemCard(item), margins(matchWrap(), 0, 0, 0, 10));
        updateBatchControls();
    }

    private View itemCard(MeshuttleItem item) {
        LinearLayout card = card();
        card.setPadding(dp(14), dp(14), dp(14), dp(14));
        LinearLayout top = row();
        top.setGravity(Gravity.TOP);
        CheckBox selected = new CheckBox(this);
        selected.setButtonTintList(new ColorStateList(
            new int[][]{new int[]{android.R.attr.state_checked}, new int[]{}},
            new int[]{AMBER, MUTED}
        ));
        selected.setChecked(selectedIds.contains(item.id));
        selected.setContentDescription("选择" + (item.isFile() ? "文件 " + item.name : "文字"));
        selected.setOnCheckedChangeListener((button, checked) -> {
            if (checked) selectedIds.add(item.id); else selectedIds.remove(item.id);
            updateBatchControls();
        });
        top.addView(selected, new LinearLayout.LayoutParams(dp(44), dp(44)));

        LinearLayout copy = column();
        copy.addView(label(item.isFile() ? item.name : "文字投递", 15, TEXT, true));
        String meta = item.isFile() ? formatSize(item.size) + " · " : "";
        meta += formatCreated(item.createdAt) + " · " + timeLeft(item.expiresAt);
        copy.addView(label(meta, 11, MUTED, false), margins(matchWrap(), 0, 4, 0, 0));
        top.addView(copy, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        Button action = button(item.isFile() ? "下载" : "复制", false);
        action.setOnClickListener(view -> {
            if (item.isFile()) beginDownloads(Collections.singletonList(item));
            else {
                ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                clipboard.setPrimaryClip(android.content.ClipData.newPlainText("Meshuttle", item.text));
                toast("文字已复制");
            }
        });
        top.addView(action, margins(new LinearLayout.LayoutParams(dp(72), dp(40)), 8, 0, 0, 0));
        card.addView(top, matchWrap());
        if (!item.isFile()) {
            String shown = item.text.length() > 5_000 ? item.text.substring(0, 5_000) + "\n…" : item.text;
            TextView body = label(shown, 13, Color.rgb(215, 220, 226), false);
            body.setTextIsSelectable(true);
            body.setBackground(rounded(Color.rgb(15, 18, 22), Color.rgb(72, 59, 32), 8));
            body.setPadding(dp(12), dp(10), dp(12), dp(10));
            card.addView(body, margins(matchWrap(), 0, 12, 0, 0));
        }
        Button delete = button("删除此项", false);
        delete.setTextColor(DANGER);
        delete.setOnClickListener(view -> confirmDelete(Collections.singletonList(item), "删除此项"));
        card.addView(delete, margins(matchWrap(), 0, 10, 0, 0));
        return card;
    }

    private void sendText(Button button) {
        String value = textComposer.getText().toString().trim();
        if (value.isEmpty()) { toast("请先输入文字"); return; }
        button.setEnabled(false);
        showProgress("正在发送文字…");
        runTask(() -> { api.createText(value); return null; }, ignored -> {
            button.setEnabled(true);
            textComposer.setText("");
            hideProgress();
            hideKeyboard();
            toast("文字已发送");
            refreshItems(false);
        }, error -> {
            button.setEnabled(true);
            hideProgress();
            toast(message(error));
        });
    }

    @SuppressWarnings("deprecation")
    private void chooseFiles() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(intent, REQUEST_FILES);
    }

    private void uploadFiles(List<Uri> uris) {
        showProgress("准备上传 " + uris.size() + " 个文件…");
        runTask(() -> {
            for (int index = 0; index < uris.size(); index++) {
                int current = index + 1;
                main.post(() -> showProgress("正在上传 " + current + "/" + uris.size() + "…"));
                api.upload(this, uris.get(index));
            }
            return uris.size();
        }, count -> {
            hideProgress();
            toast("已上传 " + count + " 个文件");
            refreshItems(false);
        }, error -> {
            hideProgress();
            toast(message(error));
            refreshItems(true);
        });
    }

    private void toggleSelectAll() {
        boolean all = !currentItems.isEmpty();
        for (MeshuttleItem item : currentItems) if (!selectedIds.contains(item.id)) { all = false; break; }
        selectedIds.clear();
        if (!all) for (MeshuttleItem item : currentItems) selectedIds.add(item.id);
        renderItems();
    }

    private List<MeshuttleItem> selectedItems() {
        List<MeshuttleItem> selected = new ArrayList<>();
        for (MeshuttleItem item : currentItems) if (selectedIds.contains(item.id)) selected.add(item);
        return selected;
    }

    private void beginSelectedDownloads() {
        List<MeshuttleItem> files = new ArrayList<>();
        for (MeshuttleItem item : selectedItems()) if (item.isFile()) files.add(item);
        if (files.isEmpty()) { toast("请先选择文件"); return; }
        beginDownloads(files);
    }

    @SuppressWarnings("deprecation")
    private void beginDownloads(List<MeshuttleItem> files) {
        pendingDownloads = new ArrayList<>(files);
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(intent, REQUEST_DOWNLOAD_FOLDER);
    }

    private void downloadItemsTo(Uri treeUri, List<MeshuttleItem> files) {
        if (files == null || files.isEmpty()) return;
        showProgress("准备下载 " + files.size() + " 个文件…");
        runTask(() -> {
            Uri parent = DocumentsContract.buildDocumentUriUsingTree(treeUri, DocumentsContract.getTreeDocumentId(treeUri));
            for (int index = 0; index < files.size(); index++) {
                MeshuttleItem item = files.get(index);
                int current = index + 1;
                main.post(() -> showProgress("正在下载 " + current + "/" + files.size() + "：" + item.name));
                Uri created = DocumentsContract.createDocument(getContentResolver(), parent,
                    item.contentType == null || item.contentType.trim().isEmpty() ? "application/octet-stream" : item.contentType,
                    safeFileName(item.name));
                if (created == null) throw new IllegalStateException("无法在所选目录创建 " + item.name);
                try {
                    OutputStream output = getContentResolver().openOutputStream(created, "w");
                    if (output == null) throw new IllegalStateException("无法写入 " + item.name);
                    api.download(item, output);
                } catch (Exception error) {
                    try { DocumentsContract.deleteDocument(getContentResolver(), created); } catch (Exception ignored) { }
                    throw error;
                }
            }
            return files.size();
        }, count -> {
            hideProgress();
            toast("已下载 " + count + " 个文件");
        }, error -> {
            hideProgress();
            toast(message(error));
        });
    }

    private void confirmDelete(List<MeshuttleItem> items, String title) {
        if (items == null || items.isEmpty()) { toast("请先选择内容"); return; }
        new AlertDialog.Builder(this)
            .setTitle(title)
            .setMessage("将从服务器及其他设备删除 " + items.size() + " 项内容，此操作不可撤销。")
            .setNegativeButton("取消", null)
            .setPositiveButton("删除", (dialog, which) -> deleteItems(items))
            .show();
    }

    private void deleteItems(List<MeshuttleItem> items) {
        showProgress("正在删除 " + items.size() + " 项内容…");
        runTask(() -> {
            for (MeshuttleItem item : items) api.deleteItem(item.id);
            return items.size();
        }, count -> {
            for (MeshuttleItem item : items) selectedIds.remove(item.id);
            hideProgress();
            toast("已删除 " + count + " 项内容");
            refreshItems(false);
        }, error -> {
            hideProgress();
            toast(message(error));
            refreshItems(true);
        });
    }

    private void updateBatchControls() {
        if (selectionText == null) return;
        List<MeshuttleItem> selected = selectedItems();
        long files = 0;
        for (MeshuttleItem item : selected) if (item.isFile()) files += 1;
        selectionText.setText(selected.isEmpty() ? "尚未选择内容" : "已选择 " + selected.size() + " 项，其中 " + files + " 个文件");
        selectAllButton.setEnabled(!currentItems.isEmpty());
        selectAllButton.setText(!currentItems.isEmpty() && selected.size() == currentItems.size() ? "取消全选" : "全选");
        downloadSelectedButton.setEnabled(files > 0);
        downloadSelectedButton.setText(files > 0 ? "下载所选文件（" + files + "）" : "下载所选文件");
        deleteSelectedButton.setEnabled(!selected.isEmpty());
        deleteSelectedButton.setText(selected.isEmpty() ? "删除所选" : "删除所选（" + selected.size() + "）");
    }

    private void setConnection(boolean online, String value) {
        if (connectionStatus == null) return;
        connectionStatus.setText(value);
        connectionStatus.setTextColor(online ? TEAL : DANGER);
    }

    private void showProgress(String value) {
        if (progressBar == null || progressText == null) return;
        View row = (View) progressBar.getParent();
        row.setVisibility(View.VISIBLE);
        progressText.setText(value);
    }

    private void hideProgress() {
        if (progressBar == null) return;
        ((View) progressBar.getParent()).setVisibility(View.GONE);
    }

    private void showLicenses() {
        new AlertDialog.Builder(this)
            .setTitle("开源许可")
            .setMessage("织梭 Meshuttle 自有代码采用 MIT License。\n\nAndroid 客户端不捆绑 Syncthing。Windows 与 macOS 桌面端的设备互联组件 Syncthing 2.1.2 采用 MPL-2.0，许可证与对应源码地址随桌面安装包提供。")
            .setPositiveButton("知道了", null)
            .show();
    }

    private void showInline(TextView view, String value, boolean error) {
        view.setText(value == null ? "操作失败" : value);
        view.setTextColor(error ? DANGER : MUTED);
        view.setVisibility(View.VISIBLE);
    }

    private <T> void runTask(Task<T> task, Result<T> success, Failure failure) {
        io.execute(() -> {
            try {
                T value = task.run();
                main.post(() -> { if (!isFinishing() && !isDestroyed()) success.accept(value); });
            } catch (Exception error) {
                main.post(() -> { if (!isFinishing() && !isDestroyed()) failure.accept(error); });
            }
        });
    }

    private LinearLayout column() {
        LinearLayout value = new LinearLayout(this);
        value.setOrientation(LinearLayout.VERTICAL);
        return value;
    }

    private LinearLayout row() {
        LinearLayout value = new LinearLayout(this);
        value.setOrientation(LinearLayout.HORIZONTAL);
        return value;
    }

    private LinearLayout card() {
        LinearLayout value = column();
        value.setPadding(dp(18), dp(18), dp(18), dp(18));
        value.setBackground(rounded(SURFACE, LINE, 12));
        return value;
    }

    private TextView label(String value, int size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setLineSpacing(0, 1.18f);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    private EditText input(String hint) {
        EditText value = new EditText(this);
        value.setHint(hint);
        value.setHintTextColor(Color.rgb(103, 114, 126));
        value.setTextColor(TEXT);
        value.setTextSize(14);
        value.setPadding(dp(13), dp(11), dp(13), dp(11));
        value.setSingleLine(true);
        value.setBackground(rounded(Color.rgb(15, 18, 22), LINE, 9));
        return value;
    }

    private Button button(String value, boolean primary) {
        Button button = new Button(this);
        button.setText(value);
        button.setAllCaps(false);
        button.setTextSize(12);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setTextColor(primary ? Color.rgb(23, 18, 8) : TEXT);
        button.setBackgroundTintList(ColorStateList.valueOf(primary ? AMBER : SURFACE_ALT));
        button.setPadding(dp(10), 0, dp(10), 0);
        return button;
    }

    private GradientDrawable rounded(int fill, int stroke, int radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(dp(radius));
        drawable.setStroke(dp(1), stroke);
        return drawable;
    }

    private ViewGroup.LayoutParams matchMatch() {
        return new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private LinearLayout.LayoutParams wrapWrap() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private LinearLayout.LayoutParams margins(LinearLayout.LayoutParams params, int left, int top, int right, int bottom) {
        params.setMargins(dp(left), dp(top), dp(right), dp(bottom));
        return params;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void hideKeyboard() {
        View focused = getCurrentFocus();
        if (focused == null) return;
        InputMethodManager keyboard = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        keyboard.hideSoftInputFromWindow(focused.getWindowToken(), 0);
    }

    private void toast(String value) {
        Toast.makeText(this, value == null || value.trim().isEmpty() ? "操作失败" : value, Toast.LENGTH_LONG).show();
    }

    private static String message(Exception error) {
        String value = error == null ? "操作失败" : error.getMessage();
        return value == null || value.trim().isEmpty() ? "操作失败" : value;
    }

    private static String safeFileName(String value) {
        String clean = value == null ? "download" : value.replaceAll("[\\x00-\\x1f\\\\/]", "_").trim();
        return clean.isEmpty() ? "download" : clean;
    }

    private static String formatSize(long bytes) {
        if (bytes >= 1024L * 1024 * 1024) return String.format(Locale.CHINA, "%.2f GB", bytes / (1024d * 1024 * 1024));
        if (bytes >= 1024L * 1024) return String.format(Locale.CHINA, "%.1f MB", bytes / (1024d * 1024));
        if (bytes >= 1024) return String.format(Locale.CHINA, "%.1f KB", bytes / 1024d);
        return bytes + " B";
    }

    private static String formatCreated(String value) {
        try {
            return DateTimeFormatter.ofPattern("MM-dd HH:mm", Locale.CHINA)
                .withZone(ZoneId.systemDefault()).format(Instant.parse(value));
        } catch (Exception ignored) { return ""; }
    }

    private static String timeLeft(String value) {
        try {
            long minutes = Math.max(0, Duration.between(Instant.now(), Instant.parse(value)).toMinutes());
            if (minutes <= 0) return "即将清理";
            if (minutes >= 24 * 60) return "剩余 " + (minutes / (24 * 60)) + " 天 " + ((minutes / 60) % 24) + " 小时";
            if (minutes >= 60) return "剩余 " + (minutes / 60) + " 小时 " + (minutes % 60) + " 分钟";
            return "剩余 " + minutes + " 分钟";
        } catch (Exception ignored) { return ""; }
    }

    private static String formatRetention(double hours) {
        long rounded = Math.max(1, Math.round(hours));
        return rounded % 24 == 0 ? (rounded / 24) + " 天" : rounded + " 小时";
    }

    @FunctionalInterface private interface Task<T> { T run() throws Exception; }
    @FunctionalInterface private interface Result<T> { void accept(T value); }
    @FunctionalInterface private interface Failure { void accept(Exception error); }
}

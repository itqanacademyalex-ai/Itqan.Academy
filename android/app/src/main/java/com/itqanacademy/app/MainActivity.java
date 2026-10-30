package com.itqanacademy.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/* تطبيق أكاديمية إتقان للأندرويد: بيفتح الموقع نفسه (أي تحديث في الموقع بيوصل التطبيق على طول)
   + أذونات الكاميرا والميكروفون + الصوت يشتغل من غير لمسة + حفظ الملفات + روابط الحصص تفتح فيه */
public class MainActivity extends Activity {
    static final String HOST = "itqanacademyalex-ai.github.io";
    static final String SITE = "https://" + HOST + "/Itqan.Academy/";
    static final int REQ_PERM = 1, REQ_FILE = 2;

    WebView web;
    PermissionRequest pendingPerm;
    ValueCallback<Uri[]> fileCb;
    String failedUrl;

    /* تنزيلات الموقع (صورة السبورة، التسجيل، التفريغ...) روابط blob مابيعرفش الأندرويد ينزّلها —
       بنحوّلها لبيانات ونحفظها في «التنزيلات» */
    static final String DL_HOOK = "(function(){if(window.__itqDl)return;window.__itqDl=1;var o=HTMLAnchorElement.prototype.click;"
            + "HTMLAnchorElement.prototype.click=function(){var h=this.href||'';if(this.download&&/^(blob|data):/.test(h)){var n=this.download;"
            + "fetch(h).then(function(r){return r.blob()}).then(function(b){var f=new FileReader();f.onload=function(){"
            + "ItqanAndroid.save(String(f.result).split(',')[1]||'',n,b.type||'application/octet-stream')};f.readAsDataURL(b)});return}"
            + "return o.call(this)}})();";

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0e1a2b"));
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0e1a2b"));
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        /* أندرويد 15 بيرسم التطبيق تحت شريط الحالة والكيبورد — نسيب مسافتهم */
        root.setOnApplyWindowInsetsListener((v, in) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets s = in.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
                v.setPadding(s.left, s.top, s.right, s.bottom);
            } else {
                v.setPadding(in.getSystemWindowInsetLeft(), in.getSystemWindowInsetTop(), in.getSystemWindowInsetRight(), in.getSystemWindowInsetBottom());
            }
            return in;
        });

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setAllowFileAccess(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        /* من غير «; wv» الموقع بيتعامل معانا كمتصفح عادي (مش «افتح في Chrome»)، وItqanAndroid عشان يعرف إنه التطبيق */
        s.setUserAgentString(s.getUserAgentString().replace("; wv)", ")") + " ItqanAndroid/" + BuildConfigVersion());
        web.addJavascriptInterface(new Bridge(), "ItqanAndroid");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                return route(r.getUrl());
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                v.evaluateJavascript(DL_HOOK, null);
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) {
                    failedUrl = r.getUrl().toString();
                    v.loadUrl("file:///android_asset/offline.html");
                }
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest req) {
                runOnUiThread(() -> askPerm(req));
            }

            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                try {
                    Intent i = p.createIntent();
                    if (p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    startActivityForResult(i, REQ_FILE);
                } catch (ActivityNotFoundException e) {
                    fileCb = null;
                    return false;
                }
                return true;
            }
        });

        if (b != null) web.restoreState(b);
        else web.loadUrl(urlFrom(getIntent()));
    }

    String BuildConfigVersion() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "1";
        }
    }

    /* رابط الحصة أو itqan:// ← صفحة الموقع؛ غير كده ← شاشة البداية */
    String urlFrom(Intent i) {
        Uri u = i == null ? null : i.getData();
        if (u != null) {
            if ("https".equals(u.getScheme()) && HOST.equals(u.getHost())) return u.toString();
            if ("itqan".equals(u.getScheme()) && u.getEncodedQuery() != null) return SITE + "?" + u.getEncodedQuery();
        }
        return SITE + "?source=app";
    }

    /* صفحات الموقع تفضل جوه التطبيق، وأي رابط تاني (واتساب، إيميل، مواقع تانية) يتفتح برّه */
    boolean route(Uri u) {
        String sc = u.getScheme();
        if ("https".equals(sc) && HOST.equals(u.getHost()) && u.getPath() != null && u.getPath().startsWith("/Itqan.Academy")) return false;
        try {
            Intent i = "intent".equals(sc) ? Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME) : new Intent(Intent.ACTION_VIEW, u);
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            i.setComponent(null);
            i.setSelector(null);
            startActivity(i);
        } catch (Exception e) {
            if ("intent".equals(sc)) {
                try {
                    String fb = Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME).getStringExtra("browser_fallback_url");
                    if (fb != null) startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(fb)));
                } catch (Exception ignored) {
                }
            }
        }
        return true;
    }

    void askPerm(PermissionRequest req) {
        List<String> need = new ArrayList<>();
        for (String r : req.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) need.add(Manifest.permission.RECORD_AUDIO);
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) need.add(Manifest.permission.CAMERA);
        }
        List<String> missing = new ArrayList<>();
        for (String p : need) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) missing.add(p);
        if (missing.isEmpty()) {
            grant(req);
            return;
        }
        if (pendingPerm != null) pendingPerm.deny();
        pendingPerm = req;
        requestPermissions(missing.toArray(new String[0]), REQ_PERM);
    }

    void grant(PermissionRequest req) {
        List<String> ok = new ArrayList<>();
        for (String r : req.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) ok.add(r);
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) ok.add(r);
        }
        if (ok.isEmpty()) req.deny();
        else req.grant(ok.toArray(new String[0]));
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        if (code == REQ_PERM && pendingPerm != null) {
            PermissionRequest r = pendingPerm;
            pendingPerm = null;
            grant(r);
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        if (code == REQ_FILE && fileCb != null) {
            Uri[] r = null;
            if (result == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    r = new Uri[n];
                    for (int i = 0; i < n; i++) r[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) r = new Uri[]{data.getData()};
            }
            fileCb.onReceiveValue(r);
            fileCb = null;
        }
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        if (i.getData() != null) web.loadUrl(urlFrom(i));
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else moveTaskToBack(true);
    }

    @Override
    protected void onSaveInstanceState(Bundle b) {
        super.onSaveInstanceState(b);
        web.saveState(b);
    }

    /* مابنعملش web.onPause() — عشان صوت الحصة يفضل شغّال لو الطالب فتح تطبيق تاني */
    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    class Bridge {
        @JavascriptInterface
        public void retry() {
            runOnUiThread(() -> web.loadUrl(failedUrl != null ? failedUrl : SITE + "?source=app"));
        }

        @JavascriptInterface
        public void save(String b64, String name, String mime) {
            String n = name == null || name.isEmpty() ? "itqan-" + System.currentTimeMillis() : name.replaceAll("[\\\\/:*?\"<>|]", "_");
            try {
                byte[] data = Base64.decode(b64, Base64.DEFAULT);
                OutputStream out;
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.MediaColumns.DISPLAY_NAME, n);
                    cv.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                    cv.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    Uri u = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    out = getContentResolver().openOutputStream(u);
                } else {
                    if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                        runOnUiThread(() -> requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, 9));
                        throw new Exception("perm");
                    }
                    File d = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                    d.mkdirs();
                    out = new FileOutputStream(new File(d, n));
                }
                out.write(data);
                out.close();
                toast("✓ اتحفظ في التنزيلات: " + n);
            } catch (Exception e) {
                toast("تعذّر حفظ الملف — حاول تاني");
            }
        }
    }

    void toast(String m) {
        runOnUiThread(() -> Toast.makeText(this, m, Toast.LENGTH_LONG).show());
    }
}

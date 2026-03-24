/**
 * 渐进增强：无文件表单用 urlencoded（与 Express.urlencoded 一致）；
 * 含文件的表单用 multipart + XHR 上传进度。
 */
(function () {
  "use strict";

  var progressEl = document.getElementById("app-progress");
  var progressFill = document.getElementById("app-progress-fill");
  var progressText = document.getElementById("app-progress-text");

  function showProgress(message, indeterminate) {
    if (!progressEl) return;
    progressEl.hidden = false;
    if (progressText) progressText.textContent = message || "处理中…";
    if (progressFill) progressFill.style.width = "0%";
    progressEl.classList.toggle("app-progress--indeterminate", !!indeterminate);
  }

  function setUploadProgress(loaded, total) {
    if (!progressFill || !total) return;
    progressEl.classList.remove("app-progress--indeterminate");
    var pct = Math.min(100, Math.round((loaded / total) * 100));
    progressFill.style.width = pct + "%";
    if (progressText) progressText.textContent = "上传中 " + pct + "%";
  }

  function hideProgress() {
    if (!progressEl) return;
    progressEl.hidden = true;
    progressEl.classList.remove("app-progress--indeterminate");
    if (progressFill) progressFill.style.width = "0%";
  }

  function formHasFile(form) {
    var files = form.querySelectorAll('input[type="file"]');
    for (var i = 0; i < files.length; i++) {
      if (files[i].files && files[i].files.length) return true;
    }
    return false;
  }

  function serializeUrlEncoded(form) {
    var params = new URLSearchParams();
    var els = form.elements;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el.name || el.disabled) continue;
      if (el.type === "file") continue;
      if (el.type === "checkbox" || el.type === "radio") {
        if (el.checked) params.append(el.name, el.value);
      } else if (el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
        params.append(el.name, el.value);
      }
    }
    return params.toString();
  }

  function postXhr(url, body, contentType, isUpload) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.setRequestHeader("Accept", "application/json");
      xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
      if (contentType) xhr.setRequestHeader("Content-Type", contentType);

      if (isUpload) {
        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable) setUploadProgress(e.loaded, e.total);
        };
      }

      xhr.onload = function () {
        var json;
        try {
          json = JSON.parse(xhr.responseText);
        } catch (e) {
          reject(new Error("服务器返回非 JSON，请直接使用表单提交（无需脚本）。"));
          return;
        }
        resolve({ status: xhr.status, json: json });
      };
      xhr.onerror = function () {
        reject(new Error("网络错误"));
      };
      xhr.send(body);
    });
  }

  function postForm(form, apiUrl) {
    var hasFile = formHasFile(form);
    if (hasFile) {
      showProgress("正在上传…", false);
      return postXhr(apiUrl, new FormData(form), null, true);
    }
    showProgress("正在处理…", true);
    var enc = serializeUrlEncoded(form);
    return postXhr(apiUrl, enc, "application/x-www-form-urlencoded", false);
  }

  function showLive(id) {
    var el = document.getElementById(id);
    if (el) el.hidden = false;
  }

  function handleJson(form, res) {
    var j = res.json;
    if (!j.ok) {
      window.alert(j.error || "处理失败");
      return;
    }

    var api = form.getAttribute("data-api-url") || "";

    if (api.indexOf("encode-base64") !== -1) {
      showLive("out-encode");
      var ta1 = document.getElementById("out-encode-dataurl");
      var ta2 = document.getElementById("out-encode-raw");
      if (ta1) ta1.value = j.dataUrl || "";
      if (ta2) ta2.value = j.rawBase64 || "";
      document.getElementById("wf-base64").scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (api.indexOf("decode-base64") !== -1) {
      showLive("out-decode");
      var img = document.getElementById("out-decode-img");
      var dl = document.getElementById("out-decode-dl");
      if (img) img.src = j.dataUrl || "";
      if (dl) {
        dl.href = j.dataUrl || "#";
        dl.download = "decoded." + (j.ext || "png");
      }
      document.getElementById("wf-base64").scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (api.indexOf("html-from-image") !== -1) {
      showLive("out-html");
      var hi = document.getElementById("out-html-img");
      var hs = document.getElementById("out-html-svg");
      if (hi) hi.value = j.htmlSnippet || "";
      if (hs) hs.value = j.svgSnippet || "";
      document.getElementById("wf-html").scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (api.indexOf("parse-html") !== -1) {
      showLive("out-parse");
      var pi = document.getElementById("out-parse-img");
      if (pi) pi.src = j.dataUrl || "";
      document.getElementById("wf-html").scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (api.indexOf("host") !== -1) {
      showLive("out-host");
      var link = document.getElementById("out-host-link");
      var exp = document.getElementById("out-host-expires");
      var im = document.getElementById("out-host-img");
      if (link) {
        link.href = j.absoluteUrl || "#";
        link.textContent = j.absoluteUrl || "";
      }
      if (exp) exp.textContent = j.expiresText ? "过期时间：" + j.expiresText : "";
      if (im) im.src = j.absoluteUrl || "";
      document.getElementById("wf-host").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  document.querySelectorAll("form[data-enhance]").forEach(function (form) {
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var apiUrl = form.getAttribute("data-api-url");
      if (!apiUrl) return;

      postForm(form, apiUrl)
        .then(function (res) {
          hideProgress();
          if (res.status >= 400) {
            window.alert((res.json && res.json.error) || "请求失败");
            return;
          }
          handleJson(form, res);
        })
        .catch(function (e) {
          hideProgress();
          window.alert(e.message || String(e));
        });
    });
  });

  /* 拖放文件 + 显示已选文件名 */
  document.querySelectorAll("[data-dropzone]").forEach(function (zone) {
    var input = zone.querySelector('input[type="file"]');
    var nameEl = zone.querySelector("[data-filename]");
    if (!input) return;

    input.addEventListener("change", function () {
      if (!nameEl) return;
      if (input.files && input.files[0]) {
        nameEl.textContent = "已选择：" + input.files[0].name;
        nameEl.hidden = false;
      } else {
        nameEl.hidden = true;
      }
    });

    ["dragenter", "dragover", "dragleave", "drop"].forEach(function (evName) {
      zone.addEventListener(evName, function (e) {
        e.preventDefault();
        e.stopPropagation();
      });
    });

    zone.addEventListener("dragenter", function () {
      zone.classList.add("upload-zone--drag");
    });
    zone.addEventListener("dragover", function () {
      zone.classList.add("upload-zone--drag");
    });
    zone.addEventListener("dragleave", function () {
      zone.classList.remove("upload-zone--drag");
    });
    zone.addEventListener("drop", function (e) {
      zone.classList.remove("upload-zone--drag");
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      try {
        var dt = new DataTransfer();
        dt.items.add(files[0]);
        input.files = dt.files;
      } catch (err) {
        return;
      }
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });
})();

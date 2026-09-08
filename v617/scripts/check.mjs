import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootUrl = new URL("../", import.meta.url);
const root = fileURLToPath(rootUrl);
const required = ["index.html", "admin/index.html", "admin/admin.js", "js/site.js", "js/config.js", "firebase/firestore.rules", "firebase/storage.rules", "firebase.json", "vercel.json"];
const problems = [];

for (const path of required) {
  try { await stat(join(root, path)); } catch { problems.push(`缺少必要檔案：${path}`); }
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) await walk(full);
    else {
      if (/\.(docx|xlsx|pdf)$/i.test(entry.name)) problems.push(`不應出現在公開網站：${entry.name}`);
      if (/\.(html|js|css|sql|md)$/i.test(entry.name)) {
        const content = await readFile(full, "utf8");
        if (/^(<<<<<<<|=======|>>>>>>>)/m.test(content)) problems.push(`尚有合併衝突：${full}`);
        if (/target=["']_blank["'](?![^>]*rel=)/i.test(content)) problems.push(`外部連結缺少 rel 保護：${full}`);
        if (/((serviceAccount|private_key)\s*[:=]\s*["'][^"']+|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY)/i.test(content)) problems.push(`疑似敏感金鑰：${full}`);
        if (/\.html$/i.test(entry.name)) {
          const refs = [...content.matchAll(/(?:src|href)=["']([^"']+)["']/gi)].map((match) => match[1]);
          for (const ref of refs) {
            if (/^(https?:|#|tel:|mailto:|data:)/i.test(ref)) continue;
            const pathOnly = ref.split(/[?#]/)[0];
            const target = pathOnly.startsWith("/") ? join(root, pathOnly.slice(1)) : join(dirname(full), pathOnly);
            try { await stat(target); } catch { problems.push(`找不到本機資源：${ref}（${full}）`); }
          }
        }
      }
    }
  }
}

await walk(root);
try { JSON.parse(await readFile(join(root, "vercel.json"), "utf8")); }
catch { problems.push("vercel.json 格式錯誤"); }
try { JSON.parse(await readFile(join(root, "firebase.json"), "utf8")); }
catch { problems.push("firebase.json 格式錯誤"); }

for (const path of ["index.html", "villa.html", "admin/index.html"]) {
  const content = await readFile(join(root, path), "utf8");
  const metaCsp = content.match(/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/i)?.[0] ?? "";
  if (!metaCsp.includes("wss://*.googleapis.com") || !metaCsp.includes("wss://*.firebaseio.com")) {
    problems.push(`CSP 缺少 Firebase WebSocket 白名單：${path}`);
  }
  if (metaCsp.includes("frame-ancestors")) problems.push(`frame-ancestors 不應放在 meta CSP：${path}`);
}

const vercelConfig = await readFile(join(root, "vercel.json"), "utf8");
if (!vercelConfig.includes("wss://*.googleapis.com") || !vercelConfig.includes("frame-ancestors 'none'")) {
  problems.push("Vercel CSP 標頭不完整");
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("檢查完成：必要檔案、敏感文件、合併衝突與常見連結問題均通過。");

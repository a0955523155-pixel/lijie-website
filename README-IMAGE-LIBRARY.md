# 圖片素材庫 V5.2

這一版已改成「相容模式」：素材庫索引直接存放在既有的 `siteContentDrafts/home` 草稿文件內，不再依賴新的 `imageLibrary` Firestore collection。

因此如果你的後台原本已可正常讀寫草稿，部署 V5.2 後，開啟素材庫不需要另外發布 `imageLibrary` 的 Firestore 規則，就能避免 `Missing or insufficient permissions`。

圖片檔案仍上傳到 Firebase Storage 的 `site-images/library/`。若只有「上傳圖片」這一步仍出現權限錯誤，請確認 Firebase Storage Rules 已允許管理員寫入 `site-images/{allPaths=**}`。

功能：
- 一次上傳多張圖片到素材庫
- 縮圖瀏覽、分類、搜尋
- 封面與各區塊可從素材庫挑圖
- 本機新上傳的圖片自動加入素材庫
- 移出素材庫不刪除 Storage 原檔
- 素材庫索引不會發布到公開網站內容

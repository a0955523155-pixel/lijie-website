# V5 圖片素材庫與可視化換圖

這一版新增「圖片素材庫」。

## 使用方式

1. 進入 `/admin/`。
2. 點「圖片素材庫」。
3. 選分類，可一次選多張照片後按「上傳到素材庫」。
4. 回到「照片管理」。
5. 直接點目前的封面、KTV、泳池、戶外料理區等照片，或按「從素材庫更換」。
6. 在縮圖素材庫選一張，即會先套用到草稿。
7. 到「預覽與發布」確認後再正式發布。

## 本機上傳也會自動進素材庫

在「照片管理」中使用原本的本機上傳，或按「從本機更換」時，新照片會同時加入 Firebase 圖片素材庫，之後可以重複使用，不必重新上傳。

## Firebase 必做

本版新增 Firestore collection：`imageLibrary`。

請將專案內：

`firebase/firestore.rules`

的內容更新到 Firebase Console → Firestore Database → Rules，並按「發布」。

Storage 仍使用既有的 `site-images/**` 規則，不需要新增另一個 bucket。

## 刪除素材的安全設計

「移出素材庫」只會刪除 Firestore 的素材索引，不會刪除 Firebase Storage 中的實際圖片檔，避免圖片正被官網或已發布版本使用時造成破圖。

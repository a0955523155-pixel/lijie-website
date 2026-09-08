// Firebase Console → Project settings → Your apps → Web app 的公開設定。
// 這些 Web 設定不是伺服器私鑰；請勿放入 service account JSON 或 private key。
export const firebaseConfig = {
  apiKey: "AIzaSyBx_R_gWT9nN-t8l7w-9fR6X0d2sS9-aIE",
  authDomain: "li-jie-s-home-official-website.firebaseapp.com",
  projectId: "li-jie-s-home-official-website",
  storageBucket: "li-jie-s-home-official-website.firebasestorage.app",
  messagingSenderId: "252164542902",
  appId: "1:252164542902:web:f48a386f4dcba962e77117"
};

export const isConfigured = () =>
  !firebaseConfig.apiKey.startsWith("YOUR_") &&
  !firebaseConfig.projectId.startsWith("YOUR_") &&
  !firebaseConfig.appId.startsWith("YOUR_");

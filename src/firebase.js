import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Credenciais expostas pelo Vite
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Verifica se as chaves básicas foram preenchidas no .env
const isConfigured = !!(
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  firebaseConfig.authDomain
);

let app = null;
let auth = null;
let db = null;

if (isConfigured) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    console.log("🔥 Firebase inicializado com sucesso em modo online!");
  } catch (error) {
    console.error("Erro ao inicializar o Firebase real:", error);
  }
} else {
  console.warn(
    "⚠️ Credenciais do Firebase ausentes no arquivo .env. O aplicativo funcionará em modo OFFLINE/LOCAL temporariamente."
  );
}

export { auth, db, isConfigured };

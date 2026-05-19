// src/firebase.js
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAOqfV67CnbMQk0JhICX1tanW-h0uK7mXM",
  authDomain: "mystery-3d0aa.firebaseapp.com",
  projectId: "mystery-3d0aa",
  storageBucket: "mystery-3d0aa.firebasestorage.app",
  messagingSenderId: "649611102774",
  appId: "1:649611102774:web:0c5cc8b87dcc0b501be697",
  measurementId: "G-XW1WJ2D1X7"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
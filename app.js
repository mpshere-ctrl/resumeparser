import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyBzUhTIuszpODRYti4gS7ks7ewbIxzvVDM",
    authDomain: "resumeparser-e6d7b.firebaseapp.com",
    projectId: "resumeparser-e6d7b",
    storageBucket: "resumeparser-e6d7b.firebasestorage.app",
    messagingSenderId: "504154767045",
    appId: "1:504154767045:web:fd4db241e37215f3f57aac",
    measurementId: "G-3RKLYGLMGD"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

let currentUser = null;
let cloudProfile = null;

// --- DOM ELEMENTS ---
const keyField = document.getElementById('geminiKey');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const profileForm = document.getElementById('profileForm');
const saveBtn = document.getElementById('saveProfileBtn');
const analyzeBtn = document.getElementById('analyzeBtn');
const tailorBtn = document.getElementById('tailorBtn');

// --- LOCAL STORAGE ---
keyField.value = localStorage.getItem('gemini_api_key') || '';
keyField.oninput = () => localStorage.setItem('gemini_api_key', keyField.value);

// --- AUTH LOGIC ---
loginBtn.onclick = () => signInWithPopup(auth, provider);
logoutBtn.onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('loginBtn').classList.add('hidden');
        document.getElementById('userInfo').classList.remove('hidden');
        document.getElementById('appInterface').classList.remove('hidden');
        document.getElementById('userNameDisplay').innerText = user.displayName;
        document.getElementById('userImg').src = user.photoURL;
        await fetchCloudProfile();
    } else {
        currentUser = null;
        document.getElementById('loginBtn').classList.remove('hidden');
        document.getElementById('userInfo').classList.add('hidden');
        document.getElementById('appInterface').classList.add('hidden');
    }
});

async function fetchCloudProfile() {
    try {
        const docRef = doc(db, "profiles", currentUser.uid);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
            cloudProfile = snap.data();
            const status = document.getElementById('syncStatus');
            status.innerText = "Profile Synced";
            status.className = "text-[10px] font-bold px-2 py-1 rounded bg-green-100 text-green-700 uppercase";
        }
    } catch (e) {
        console.error("Profile fetch error:", e);
    }
}

// --- API HELPER ---
async function apiCall(endpoint, body) {
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'x-gemini-key': keyField.value
        },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || "Server Error");
    }
    return response.json();
}

// --- PROFILE UPLOAD ---
profileForm.onsubmit = async (e) => {
    e.preventDefault();
    saveBtn.innerText = "Processing...";
    saveBtn.disabled = true;

    const fd = new FormData();
    const fileInput = document.getElementById('resumeFiles');
    for (let i = 0; i < fileInput.files.length; i++) {
        fd.append('resumes', fileInput.files[i]);
    }
    fd.append('linkedinText', document.getElementById('linkedinText').value);

    try {
        const res = await fetch('/api/ingest-profile', {
            method: 'POST',
            headers: { 'x-gemini-key': keyField.value },
            body: fd
        });
        
        if (!res.ok) throw new Error("Failed to process documents");
        
        const data = await res.json();
        
        cloudProfile = { 
            userName: data.extractedName, 
            profileText: data.fullText, 
            updatedAt: Date.now() 
        };

        await setDoc(doc(db, "profiles", currentUser.uid), cloudProfile);
        alert(`Profile updated for ${data.extractedName}`);
        await fetchCloudProfile();
    } catch (err) {
        alert("Upload Error: " + err.message);
    } finally {
        saveBtn.innerText = "Update Cloud Profile";
        saveBtn.disabled = false;
    }
};

// --- ANALYSIS ---
analyzeBtn.onclick = async () => {
    if (!cloudProfile) return alert("Upload your profile first!");
    analyzeBtn.innerText = "Analyzing...";
    try {
        const data = await apiCall('/api/analyze-suitability', {
            userName: cloudProfile.userName,
            profileText: cloudProfile.profileText,
            jobDescription: document.getElementById('jobDesc').value
        });
        const out = document.getElementById('analysisResult');
        out.innerText = data.analysis;
        out.classList.remove('hidden');
    } catch (err) {
        alert(err.message);
    } finally {
        analyzeBtn.innerText = "Analyze Fit";
    }
};

// --- TAILORING ---
let currentResumeText = "";
tailorBtn.onclick = async () => {
    if (!cloudProfile) return alert("Upload your profile first!");
    tailorBtn.innerText = "Tailoring...";
    try {
        const data = await apiCall('/api/tailor-resume', {
            userName: cloudProfile.userName,
            profileText: cloudProfile.profileText,
            jobDescription: document.getElementById('jobDesc').value
        });
        currentResumeText = data.tailoredText;
        document.getElementById('resumeOutputText').innerText = currentResumeText;
        document.getElementById('resumeResult').classList.remove('hidden');
    } catch (err) {
        alert(err.message);
    } finally {
        tailorBtn.innerText = "Tailor Resume";
    }
};

// --- DOCX ---
document.getElementById('downloadDocx').onclick = async () => {
    try {
        const res = await fetch('/api/download-docx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resumeText: currentResumeText })
        });
        const blob = await res.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${cloudProfile.userName}_Resume.docx`;
        link.click();
    } catch (err) {
        alert("Download failed");
    }
};
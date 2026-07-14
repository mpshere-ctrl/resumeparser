import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";

// --- 1. FIREBASE CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyBzUhTIuszpODRYti4gS7ks7ewbIxzvVDM",
    authDomain: "resumeparser-e6d7b.firebaseapp.com",
    projectId: "resumeparser-e6d7b",
    storageBucket: "resumeparser-e6d7b.firebasestorage.app",
    messagingSenderId: "504154767045",
    appId: "1:504154767045:web:fd4db241e37215f3f57aac"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
let currentUser = null;

// PDF.js Worker Setup (Required for browser-side PDF reading)
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// --- 2. FILE PARSING HELPERS (Browser-Side) ---
async function extractTextFromFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    if (file.name.endsWith('.docx')) {
        const result = await mammoth.extractRawText({ arrayBuffer });
        return result.value;
    } else if (file.name.endsWith('.pdf')) {
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = "";
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            fullText += content.items.map(s => s.str).join(" ") + "\n";
        }
        return fullText;
    }
    return "";
}

// --- 3. AUTHENTICATION MONITOR ---
onAuthStateChanged(auth, async (user) => {
    const loginBtn = document.getElementById('loginBtn');
    const userInfo = document.getElementById('userInfo');
    const appInterface = document.getElementById('appInterface');
    const displayName = document.getElementById('displayName');
    const syncStatus = document.getElementById('syncStatus');

    if (user) {
        currentUser = user;
        loginBtn.classList.add('hidden');
        userInfo.classList.remove('hidden');
        appInterface.classList.remove('hidden');
        displayName.innerText = user.displayName;
        
        // Load saved API key from local storage
        document.getElementById('geminiKey').value = localStorage.getItem('gemini_key') || '';
        
        // Check Cloud Profile
        const docSnap = await getDoc(doc(db, "profiles", user.uid));
        if (docSnap.exists()) {
            syncStatus.innerText = "Cloud Profile: " + docSnap.data().userName;
            syncStatus.className = "text-[10px] bg-green-100 text-green-700 p-1 px-2 rounded font-bold uppercase";
        } else {
            syncStatus.innerText = "No Cloud Profile Found";
        }
    } else {
        appInterface.classList.add('hidden');
        loginBtn.classList.remove('hidden');
        userInfo.classList.add('hidden');
    }
});

// Auth Actions
document.getElementById('loginBtn').onclick = () => signInWithPopup(auth, provider);
document.getElementById('logoutBtn').onclick = () => signOut(auth);

// --- 4. SYNC ACTION (Process Files & Save to Firestore) ---
document.getElementById('syncBtn').onclick = async () => {
    const key = document.getElementById('geminiKey').value;
    if (!key) return alert("Please enter your Gemini API Key first.");
    localStorage.setItem('gemini_key', key);

    const btn = document.getElementById('syncBtn');
    btn.innerText = "Parsing Locally...";
    btn.disabled = true;

    try {
        let combinedText = document.getElementById('linkedinText').value + "\n";
        const files = document.getElementById('resumeFiles').files;
        
        for (const file of files) {
            combinedText += await extractTextFromFile(file) + "\n";
        }

        // Extract Name using Gemini
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(`Extract only the full name from this text: ${combinedText.substring(0, 2000)}`);
        const name = result.response.text().trim();

        // Save Full Context to Firestore
        await setDoc(doc(db, "profiles", currentUser.uid), {
            userName: name,
            profileText: combinedText,
            updatedAt: Date.now()
        });

        alert("Profile context processed and saved to Cloud!");
        location.reload();
    } catch (err) {
        alert("Sync Error: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = "Process & Save to Cloud";
    }
};

// --- 5. ANALYZE SUITABILITY ACTION ---
document.getElementById('analyzeBtn').onclick = async () => {
    const key = document.getElementById('geminiKey').value;
    const jobInput = document.getElementById('jobDesc').value;
    if (!jobInput) return alert("Please paste a Job Description or URL first.");

    const btn = document.getElementById('analyzeBtn');
    const reportArea = document.getElementById('analysisArea');
    const reportDiv = document.getElementById('analysisReport');

    btn.innerText = "Analyzing Fit...";
    btn.disabled = true;

    try {
        const docSnap = await getDoc(doc(db, "profiles", currentUser.uid));
        if (!docSnap.exists()) throw new Error("No profile found. Please Sync first.");
        const profile = docSnap.data();

        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `
            Act as an expert Technical Recruiter. 
            Compare the following Candidate Profile with the Job Description/URL provided.
            
            CANDIDATE PROFILE:
            ${profile.profileText}
            
            JOB DESCRIPTION/URL:
            ${jobInput}
            
            PROVIDE A SHORT REPORT:
            1. Match Score: (0-100%)
            2. Top 3 Strengths: (Why the candidate fits)
            3. Critical Gaps: (Missing skills or experience)
            4. Verdict: (One sentence advice)
            
            Use professional tone. No markdown symbols like * or #.
        `;

        const result = await model.generateContent(prompt);
        reportDiv.innerText = result.response.text();
        reportArea.classList.remove('hidden');
        reportArea.scrollIntoView({ behavior: 'smooth' });

    } catch (err) {
        alert("Analysis Error: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = "Analyze Suitability";
    }
};

// --- 6. TAILOR RESUME ACTION ---
document.getElementById('tailorBtn').onclick = async () => {
    const key = document.getElementById('geminiKey').value;
    const job = document.getElementById('jobDesc').value;
    if (!job) return alert("Paste a job description first.");

    const btn = document.getElementById('tailorBtn');
    const resumeView = document.getElementById('resumeView');
    const resumeText = document.getElementById('resumeText');

    btn.innerText = "AI is Writing...";
    btn.disabled = true;

    try {
        const docSnap = await getDoc(doc(db, "profiles", currentUser.uid));
        if (!docSnap.exists()) throw new Error("No profile found. Please Sync first.");
        const profile = docSnap.data();

        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `Rewrite a professional resume for ${profile.userName} tailored to this job: ${job}. 
        Use this background context: ${profile.profileText}. 
        CONSTRAINT: Output ONLY plain text. Do NOT use markdown symbols like asterisks (*) or hashtags (#).`;

        const result = await model.generateContent(prompt);
        resumeText.innerText = result.response.text();
        resumeView.classList.remove('hidden');
        resumeView.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
        alert("Tailor Error: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = "Tailor Resume";
    }
};

// --- 7. DOWNLOAD DOCX ACTION ---
document.getElementById('downloadBtn').onclick = async () => {
    const text = document.getElementById('resumeText').innerText;
    const docObj = new docx.Document({
        sections: [{
            children: text.split('\n').map(line => new docx.Paragraph({
                children: [new docx.TextRun(line)]
            }))
        }]
    });

    const blob = await docx.Packer.toBlob(docObj);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = "Tailored_Resume.docx";
    a.click();
};

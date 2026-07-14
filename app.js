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

// PDF.js Worker Setup
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// --- 2. HELPERS ---
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

function appendChatMessage(role, text) {
    const chatBox = document.getElementById('chatBox');
    const msgDiv = document.createElement('div');
    msgDiv.className = role === 'user' ? 'text-right' : 'text-left';
    const span = document.createElement('span');
    span.className = role === 'user' 
        ? 'inline-block bg-blue-600 text-white p-3 rounded-2xl rounded-tr-none text-xs max-w-[80%]' 
        : 'inline-block bg-white border border-slate-200 p-3 rounded-2xl rounded-tl-none text-xs max-w-[80%]';
    span.innerText = text;
    msgDiv.appendChild(span);
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

// --- 3. AUTH MONITOR ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('loginBtn').classList.add('hidden');
        document.getElementById('userInfo').classList.remove('hidden');
        document.getElementById('appInterface').classList.remove('hidden');
        document.getElementById('displayName').innerText = user.displayName;
        document.getElementById('geminiKey').value = localStorage.getItem('gemini_key') || '';
        
        const docSnap = await getDoc(doc(db, "profiles", user.uid));
        if (docSnap.exists()) {
            document.getElementById('syncStatus').innerText = "Cloud Profile: " + docSnap.data().userName;
            document.getElementById('syncStatus').className = "text-[10px] bg-green-100 text-green-700 p-1 px-2 rounded font-bold uppercase";
        }
    } else {
        document.getElementById('appInterface').classList.add('hidden');
        document.getElementById('loginBtn').classList.remove('hidden');
        document.getElementById('userInfo').classList.add('hidden');
    }
});

document.getElementById('loginBtn').onclick = () => signInWithPopup(auth, provider);
document.getElementById('logoutBtn').onclick = () => signOut(auth);

// --- 4. SYNC ACTION ---
document.getElementById('syncBtn').onclick = async () => {
    const key = document.getElementById('geminiKey').value;
    if (!key) return alert("Enter Gemini Key!");
    localStorage.setItem('gemini_key', key);

    const btn = document.getElementById('syncBtn');
    btn.innerText = "Processing...";
    btn.disabled = true;

    try {
        let combinedText = document.getElementById('linkedinText').value + "\n";
        const files = document.getElementById('resumeFiles').files;
        for (const file of files) combinedText += await extractTextFromFile(file) + "\n";

        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });
        const result = await model.generateContent(`Extract the full name from this text: ${combinedText.substring(0, 2000)}`);
        const name = result.response.text().trim();

        await setDoc(doc(db, "profiles", currentUser.uid), {
            userName: name,
            profileText: combinedText,
            updatedAt: Date.now()
        });

        alert("Profile Saved!");
        location.reload();
    } catch (err) { alert(err.message); }
    finally { btn.disabled = false; btn.innerText = "Process & Save to Cloud"; }
};

// --- 5. ANALYZE ACTION ---
document.getElementById('analyzeBtn').onclick = async () => {
    const key = document.getElementById('geminiKey').value;
    const job = document.getElementById('jobDesc').value;
    if (!job) return alert("Paste Job Description!");

    const btn = document.getElementById('analyzeBtn');
    btn.innerText = "Analyzing...";
    btn.disabled = true;

    try {
        const docSnap = await getDoc(doc(db, "profiles", currentUser.uid));
        const profile = docSnap.data();

        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `Compare this profile: ${profile.profileText} to this job: ${job}. Provide a match score, strengths, and gaps. No markdown.`;

        const result = await model.generateContent(prompt);
        document.getElementById('analysisReport').innerText = result.response.text();
        document.getElementById('analysisArea').classList.remove('hidden');
    } catch (err) { alert(err.message); }
    finally { btn.disabled = false; btn.innerText = "Analyze Suitability"; }
};

// --- 6. TAILOR ACTION ---
document.getElementById('tailorBtn').onclick = async () => {
    const key = document.getElementById('geminiKey').value;
    const job = document.getElementById('jobDesc').value;
    const btn = document.getElementById('tailorBtn');
    btn.innerText = "Writing...";
    btn.disabled = true;

    try {
        const docSnap = await getDoc(doc(db, "profiles", currentUser.uid));
        const profile = docSnap.data();

        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `Rewrite a resume for ${profile.userName} for this job: ${job}. Use context: ${profile.profileText}. Plain text only, no markdown.`;

        const result = await model.generateContent(prompt);
        document.getElementById('resumeText').innerText = result.response.text();
        document.getElementById('resumeView').classList.remove('hidden');
    } catch (err) { alert(err.message); }
    finally { btn.disabled = false; btn.innerText = "Tailor Resume"; }
};

// --- 7. CHATBOT ACTION (Gemini 3.1 Flash-Lite) ---
document.getElementById('chatSendBtn').onclick = async () => {
    const key = document.getElementById('geminiKey').value;
    const userInput = document.getElementById('chatInput').value;
    const jobDesc = document.getElementById('jobDesc').value;
    if (!userInput) return;

    appendChatMessage('user', userInput);
    document.getElementById('chatInput').value = "";

    try {
        const docSnap = await getDoc(doc(db, "profiles", currentUser.uid));
        const profile = docSnap.data();
        const tailoredResume = document.getElementById('resumeText').innerText;

        const genAI = new GoogleGenerativeAI(key);
        // Using the requested Gemini 3.1 Flash-Lite model
        const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });

        const systemContext = `
            You are an expert Career Coach. You have access to the following data:
            USER PROFILE: ${profile.profileText}
            TARGET JOB: ${jobDesc || "Not provided yet"}
            TAILORED RESUME: ${tailoredResume || "Not generated yet"}
            
            Use this data to answer the user's specific questions. 
            Be concise, professional, and helpful. No markdown symbols.
        `;

        const result = await model.generateContent(`${systemContext}\n\nUSER QUESTION: ${userInput}`);
        appendChatMessage('ai', result.response.text());
    } catch (err) {
        appendChatMessage('ai', "Error: " + err.message);
    }
};

// --- 8. DOWNLOAD ---
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
    a.href = url; a.download = "Tailored_Resume.docx"; a.click();
};

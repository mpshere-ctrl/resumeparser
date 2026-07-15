import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";

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
let lastTailoredJson = null;

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// --- THEME & UI ---
const themeToggle = document.getElementById('themeToggle');
const body = document.body;

if (themeToggle) {
    themeToggle.onclick = () => {
        const isDark = body.classList.contains('dark-mode');
        body.classList.toggle('dark-mode', !isDark);
        body.classList.toggle('light-mode', isDark);
        localStorage.setItem('theme', isDark ? 'light-mode' : 'dark-mode');
    };
}

if (localStorage.getItem('theme') === 'light-mode') {
    body.classList.replace('dark-mode', 'light-mode');
}

const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
tabBtns.forEach(btn => {
    btn.onclick = () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        const target = document.getElementById(btn.dataset.tab);
        if (target) target.classList.add('active');
    };
});

// --- HELPERS ---
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

function cleanAiOutput(text) {
    return text.replace(/[*#]/g, '').trim();
}

function appendChatMessage(role, text) {
    const chatBox = document.getElementById('chatBox');
    if (!chatBox) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = role === 'user' ? 'flex justify-end' : 'flex justify-start';
    const inner = document.createElement('div');
    inner.className = role === 'user' 
        ? 'bg-blue-600 text-white p-4 rounded-2xl rounded-tr-none text-xs max-w-[85%]' 
        : 'bg-white/10 border border-white/5 text-slate-300 p-4 rounded-2xl rounded-tl-none text-xs max-w-[85%]';
    inner.innerText = text;
    msgDiv.appendChild(inner);
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

// --- AUTH ---
onAuthStateChanged(auth, async (user) => {
    const loginBtn = document.getElementById('loginBtn');
    const userInfo = document.getElementById('userInfo');
    const appInterface = document.getElementById('appInterface');
    const tabNav = document.getElementById('tabNav');
    const displayName = document.getElementById('displayName');
    const syncStatus = document.getElementById('syncStatus');

    if (user) {
        currentUser = user;
        if (loginBtn) loginBtn.classList.add('hidden');
        if (userInfo) userInfo.classList.remove('hidden');
        if (appInterface) appInterface.classList.remove('hidden');
        if (tabNav) tabNav.classList.remove('hidden');
        if (displayName) displayName.innerText = user.displayName;
        const keyInput = document.getElementById('geminiKey');
        if (keyInput) keyInput.value = localStorage.getItem('gemini_key') || '';
        const docSnap = await getDoc(doc(db, "profiles", user.uid));
        if (docSnap.exists() && syncStatus) {
            syncStatus.innerText = docSnap.data().userName;
            syncStatus.className = "text-[9px] text-blue-500 uppercase font-black";
        }
    } else {
        if (appInterface) appInterface.classList.add('hidden');
        if (tabNav) tabNav.classList.add('hidden');
        if (loginBtn) loginBtn.classList.remove('hidden');
        if (userInfo) userInfo.classList.add('hidden');
    }
});

const loginBtn = document.getElementById('loginBtn');
if (loginBtn) loginBtn.onclick = () => signInWithPopup(auth, provider);

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) logoutBtn.onclick = () => signOut(auth);

// --- CORE ACTIONS ---

// INCREMENTAL UPDATE
const syncBtn = document.getElementById('syncBtn');
if (syncBtn) {
    syncBtn.onclick = async () => {
        const key = document.getElementById('geminiKey').value;
        if (!key) return alert("API Key Required");
        localStorage.setItem('gemini_key', key);
        syncBtn.innerText = "Updating...";
        syncBtn.disabled = true;
        try {
            // Get existing profile text
            const docSnap = await getDoc(doc(db, "profiles", currentUser.uid));
            let existingText = docSnap.exists() ? docSnap.data().profileText : "";

            let newText = document.getElementById('linkedinText').value + "\n";
            const files = document.getElementById('resumeFiles').files;
            for (const file of files) newText += await extractTextFromFile(file) + "\n";
            
            const combinedText = existingText + "\n" + newText;

            const genAI = new GoogleGenerativeAI(key);
            const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });
            const result = await model.generateContent(`Extract the full name from this data. Return only the name: ${combinedText.substring(0, 2000)}`);
            const name = result.response.text().trim();
            
            await setDoc(doc(db, "profiles", currentUser.uid), { userName: name, profileText: combinedText, updatedAt: Date.now() });
            alert("Profile context updated.");
            location.reload();
        } catch (err) { console.error(err); }
        finally { syncBtn.disabled = false; syncBtn.innerText = "Update Profile Context"; }
    };
}

// CLEAR HISTORY
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
if (clearHistoryBtn) {
    clearHistoryBtn.onclick = async () => {
        if (confirm("This will permanently delete your profile context and history. Continue?")) {
            await deleteDoc(doc(db, "profiles", currentUser.uid));
            alert("History cleared.");
            location.reload();
        }
    };
}

const analyzeBtn = document.getElementById('analyzeBtn');
if (analyzeBtn) {
    analyzeBtn.onclick = async () => {
        const key = document.getElementById('geminiKey').value;
        const job = document.getElementById('jobDesc').value;
        if (!job) return;
        analyzeBtn.innerText = "Analyzing...";
        analyzeBtn.disabled = true;
        try {
            const docSnap = await getDoc(doc(db, "profiles", currentUser.uid));
            const profile = docSnap.data();
            const genAI = new GoogleGenerativeAI(key);
            const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });
            const prompt = `Act as a discriminatively honest Technical Recruiter. Assessment: ${profile.profileText} vs Job: ${job}. Plain text only. No sugarcoating. No markdown.`;
            const result = await model.generateContent(prompt);
            document.getElementById('analysisReport').innerText = cleanAiOutput(result.response.text());
            document.getElementById('analysisArea').classList.remove('hidden');
        } catch (err) { console.error(err); }
        finally { analyzeBtn.disabled = false; analyzeBtn.innerText = "Analyze Suitability"; }
    };
}

const tailorBtn = document.getElementById('tailorBtn');
if (tailorBtn) {
    tailorBtn.onclick = async () => {
        const key = document.getElementById('geminiKey').value;
        const job = document.getElementById('jobDesc').value;
        tailorBtn.innerText = "Generating...";
        tailorBtn.disabled = true;
        try {
            const docSnap = await getDoc(doc(db, "profiles", currentUser.uid));
            const profile = docSnap.data();
            const genAI = new GoogleGenerativeAI(key);
            const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });
            const prompt = `Rewrite a professional resume for ${profile.userName} tailored to: ${job}. 
            Use context: ${profile.profileText}. 
            Output MUST be a valid JSON object with keys: "name", "contact" (object with email, phone, address, linkedin), "summary", "experience" (array of {title, company, date, bullets[]}), "education" (array of {degree, school, date}), "skills" (array of strings). 
            IMPORTANT: Optimize for ATS. Do not include markdown code blocks.`;
            const result = await model.generateContent(prompt);
            let rawJson = result.response.text().replace(/```json|```/g, "").trim();
            lastTailoredJson = JSON.parse(rawJson);
            document.getElementById('resumeText').innerText = JSON.stringify(lastTailoredJson, null, 2);
            document.getElementById('resumeView').classList.remove('hidden');
        } catch (err) { console.error(err); }
        finally { tailorBtn.disabled = false; tailorBtn.innerText = "Generate ATS Resume"; }
    };
}

const chatSendBtn = document.getElementById('chatSendBtn');
if (chatSendBtn) {
    chatSendBtn.onclick = async () => {
        const key = document.getElementById('geminiKey').value;
        const userInput = document.getElementById('chatInput').value;
        const jobDesc = document.getElementById('jobDesc').value;
        if (!userInput || !key) return;
        appendChatMessage('user', userInput);
        document.getElementById('chatInput').value = "";
        try {
            const docSnap = await getDoc(doc(db, "profiles", currentUser.uid));
            const profile = docSnap.data();
            const genAI = new GoogleGenerativeAI(key);
            const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });
            const systemContext = `Discriminatively honest Career Coach. Do not sugarcoat. Profile: ${profile.profileText} Job: ${jobDesc}. No markdown.`;
            const result = await model.generateContent(`${systemContext}\n\nUser Query: ${userInput}`);
            appendChatMessage('ai', cleanAiOutput(result.response.text()));
        } catch (err) { appendChatMessage('ai', "Error."); }
    };
}

// --- ATS-FRIENDLY DOCX ENGINE ---
document.getElementById('downloadBtn').onclick = async () => {
    if (!lastTailoredJson) return;
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } = window.docx;
    
    // Format Contact String
    const contactInfo = `${lastTailoredJson.contact.email} | ${lastTailoredJson.contact.phone}\n${lastTailoredJson.contact.address}\n${lastTailoredJson.contact.linkedin}`;

    const children = [
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: lastTailoredJson.name.toUpperCase(), bold: true, size: 28, font: "Arial" })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: contactInfo, size: 18, font: "Arial" })], spacing: { after: 300 } }),
        
        new Paragraph({ text: "SUMMARY", heading: HeadingLevel.HEADING_1, border: { bottom: { color: "auto", space: 1, style: BorderStyle.SINGLE, size: 6 } } }),
        new Paragraph({ children: [new TextRun({ text: lastTailoredJson.summary, font: "Arial", size: 20 })], spacing: { before: 150, after: 300 } }),

        new Paragraph({ text: "EXPERIENCE", heading: HeadingLevel.HEADING_1, border: { bottom: { color: "auto", space: 1, style: BorderStyle.SINGLE, size: 6 } } }),
    ];

    lastTailoredJson.experience.forEach(exp => {
        children.push(new Paragraph({
            spacing: { before: 200 },
            children: [
                new TextRun({ text: exp.title, bold: true, font: "Arial", size: 20 }),
                new TextRun({ text: `\t${exp.date}`, bold: true, font: "Arial", size: 20 }),
            ],
        }));
        children.push(new Paragraph({ children: [new TextRun({ text: exp.company, italic: true, font: "Arial", size: 20 })], spacing: { after: 100 } }));
        exp.bullets.forEach(b => {
            children.push(new Paragraph({ text: b.replace(/[*#]/g, ''), bullet: { level: 0 }, spacing: { before: 50 }, font: "Arial" }));
        });
    });

    children.push(new Paragraph({ text: "EDUCATION", heading: HeadingLevel.HEADING_1, border: { bottom: { color: "auto", space: 1, style: BorderStyle.SINGLE, size: 6 } }, spacing: { before: 300 } }));
    lastTailoredJson.education.forEach(edu => {
        children.push(new Paragraph({
            spacing: { before: 150 },
            children: [
                new TextRun({ text: edu.degree, bold: true, font: "Arial", size: 20 }),
                new TextRun({ text: `\t${edu.date}`, bold: true, font: "Arial", size: 20 }),
            ],
        }));
        children.push(new Paragraph({ children: [new TextRun({ text: edu.school, font: "Arial", size: 20 })] }));
    });

    children.push(new Paragraph({ text: "SKILLS", heading: HeadingLevel.HEADING_1, border: { bottom: { color: "auto", space: 1, style: BorderStyle.SINGLE, size: 6 } }, spacing: { before: 300 } }));
    children.push(new Paragraph({ text: lastTailoredJson.skills.join(", "), spacing: { before: 150 }, font: "Arial", size: 20 }));

    const docObj = new Document({ sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } }, children }] });
    const blob = await Packer.toBlob(docObj);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${lastTailoredJson.name.replace(/\s/g, "_")}_Resume.docx`; a.click();
};

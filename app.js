import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
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
    msgDiv.className = role === 'user' ? 'flex justify-end' : 'flex justify-start';
    const inner = document.createElement('div');
    inner.className = role === 'user' 
        ? 'bg-blue-600 text-white p-5 rounded-2xl rounded-tr-none text-xs max-w-[85%] shadow-xl font-medium' 
        : 'bg-white/5 border border-white/5 text-slate-300 p-5 rounded-2xl rounded-tl-none text-xs max-w-[85%] font-medium';
    inner.innerText = text;
    msgDiv.appendChild(inner);
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

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
            document.getElementById('syncStatus').innerText = docSnap.data().userName;
            document.getElementById('syncStatus').className = "text-[9px] text-blue-400 uppercase font-black tracking-widest";
        }
    } else {
        document.getElementById('appInterface').classList.add('hidden');
        document.getElementById('loginBtn').classList.remove('hidden');
        document.getElementById('userInfo').classList.add('hidden');
    }
});

document.getElementById('loginBtn').onclick = () => signInWithPopup(auth, provider);
document.getElementById('logoutBtn').onclick = () => signOut(auth);

document.getElementById('syncBtn').onclick = async () => {
    const key = document.getElementById('geminiKey').value;
    if (!key) return;
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
        const result = await model.generateContent(`Extract the full name from the following data. Return only the name: ${combinedText.substring(0, 2000)}`);
        const name = result.response.text().trim();
        await setDoc(doc(db, "profiles", currentUser.uid), { userName: name, profileText: combinedText, updatedAt: Date.now() });
        location.reload();
    } catch (err) { console.error(err); }
    finally { btn.disabled = false; btn.innerText = "Synchronize Profile"; }
};

document.getElementById('analyzeBtn').onclick = async () => {
    const key = document.getElementById('geminiKey').value;
    const job = document.getElementById('jobDesc').value;
    if (!job) return;
    const btn = document.getElementById('analyzeBtn');
    btn.innerText = "Analyzing...";
    btn.disabled = true;
    try {
        const docSnap = await getDoc(doc(db, "profiles", currentUser.uid));
        const profile = docSnap.data();
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });
        const prompt = `Act as a discriminatively honest Technical Recruiter. Assessment: ${profile.profileText} vs Job: ${job}. Plain text only.`;
        const result = await model.generateContent(prompt);
        document.getElementById('analysisReport').innerText = result.response.text();
        document.getElementById('analysisArea').classList.remove('hidden');
        document.getElementById('analysisArea').scrollIntoView({ behavior: 'smooth' });
    } catch (err) { console.error(err); }
    finally { btn.disabled = false; btn.innerText = "Analyze Fit"; }
};

document.getElementById('tailorBtn').onclick = async () => {
    const key = document.getElementById('geminiKey').value;
    const job = document.getElementById('jobDesc').value;
    const btn = document.getElementById('tailorBtn');
    btn.innerText = "Generating...";
    btn.disabled = true;
    try {
        const docSnap = await getDoc(doc(db, "profiles", currentUser.uid));
        const profile = docSnap.data();
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });

        const prompt = `Rewrite a professional resume for ${profile.userName} tailored to: ${job}. 
        Use context: ${profile.profileText}. 
        Output MUST be a valid JSON object with these keys: 
        "name", "contact" (string), "summary", 
        "experience" (array of {title, company, date, bullets[]}), 
        "education" (array of {degree, school, date}), 
        "skills" (array of strings). 
        Do not include markdown code blocks.`;

        const result = await model.generateContent(prompt);
        let rawJson = result.response.text().replace(/```json|```/g, "").trim();
        lastTailoredJson = JSON.parse(rawJson);

        // Display a preview
        document.getElementById('resumeText').innerText = JSON.stringify(lastTailoredJson, null, 2);
        document.getElementById('resumeView').classList.remove('hidden');
        document.getElementById('resumeView').scrollIntoView({ behavior: 'smooth' });
    } catch (err) { console.error(err); alert("Failed to generate structured data. Try again."); }
    finally { btn.disabled = false; btn.innerText = "Tailor Resume"; }
};

document.getElementById('chatSendBtn').onclick = async () => {
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
        const systemContext = `Honest Career Consultant. Profile: ${profile.profileText} Job: ${jobDesc}. No markdown.`;
        const result = await model.generateContent(`${systemContext}\n\nUser Query: ${userInput}`);
        appendChatMessage('ai', result.response.text());
    } catch (err) { appendChatMessage('ai', "Error processing query."); }
};

// --- HIGH FIDELITY DOCX GENERATOR ---
document.getElementById('downloadBtn').onclick = async () => {
    if (!lastTailoredJson) return;

    const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } = docx;

    const children = [
        // Header
        new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: lastTailoredJson.name, bold: true, size: 32 })],
        }),
        new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: lastTailoredJson.contact, size: 20 })],
            spacing: { after: 400 },
        }),

        // Summary
        new Paragraph({ text: "PROFESSIONAL SUMMARY", heading: HeadingLevel.HEADING_2, border: { bottom: { color: "auto", space: 1, style: BorderStyle.SINGLE, size: 6 } } }),
        new Paragraph({ children: [new TextRun(lastTailoredJson.summary)], spacing: { before: 200, after: 400 } }),

        // Experience
        new Paragraph({ text: "PROFESSIONAL EXPERIENCE", heading: HeadingLevel.HEADING_2, border: { bottom: { color: "auto", space: 1, style: BorderStyle.SINGLE, size: 6 } } }),
    ];

    lastTailoredJson.experience.forEach(exp => {
        children.push(new Paragraph({
            spacing: { before: 200 },
            children: [
                new TextRun({ text: exp.title, bold: true }),
                new TextRun({ text: ` | ${exp.company}`, italic: true }),
                new TextRun({ text: `\t${exp.date}`, bold: true }),
            ],
        }));
        exp.bullets.forEach(b => {
            children.push(new Paragraph({ text: b, bullet: { level: 0 }, spacing: { before: 100 } }));
        });
    });

    // Education
    children.push(new Paragraph({ text: "EDUCATION", heading: HeadingLevel.HEADING_2, border: { bottom: { color: "auto", space: 1, style: BorderStyle.SINGLE, size: 6 } }, spacing: { before: 400 } }));
    lastTailoredJson.education.forEach(edu => {
        children.push(new Paragraph({
            spacing: { before: 200 },
            children: [
                new TextRun({ text: edu.degree, bold: true }),
                new TextRun({ text: ` | ${edu.school}` }),
                new TextRun({ text: `\t${edu.date}` }),
            ],
        }));
    });

    // Skills
    children.push(new Paragraph({ text: "SKILLS", heading: HeadingLevel.HEADING_2, border: { bottom: { color: "auto", space: 1, style: BorderStyle.SINGLE, size: 6 } }, spacing: { before: 400 } }));
    children.push(new Paragraph({ text: lastTailoredJson.skills.join(" • "), spacing: { before: 200 } }));

    const docObj = new Document({
        sections: [{ properties: {}, children: children }],
    });

    const blob = await Packer.toBlob(docObj);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${lastTailoredJson.name.replace(/\s/g, "_")}_Resume.docx`; a.click();
};

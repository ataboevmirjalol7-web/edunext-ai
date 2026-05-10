const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const cors = require('cors');

// Ish katalogni qayerdan ishga tushirganingizdan qat'i nazar, loyiha ildizidagi .env dan o'qiladi.
dotenv.config({ path: path.join(__dirname, '.env') });

if (!String(process.env.GROQ_API_KEY || '').trim()) {
    console.warn('⚠️  GROQ_API_KEY .env da mavjud emas — /api/ai/chat va Writing tekshiruvi ishlamaydi.');
}

const app = express();

// CORS: frontend va backend alohida domenlarda bo'lsa kerak bo'lishi mumkin
const corsOrigins = String(process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
if (corsOrigins.length) {
    app.use(
        cors({
            origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
            credentials: true,
        }),
    );
}

// 1. Middleware
app.use(express.json());

/**
 * Brauzer uchun API joylashuvi (Deployment).
 * PUBLIC_API_BASE_URL bo'sh bo'lsa — nisbiy yo'l `/api/...` (bir serverda static + API).
 * To'ldirilsa — faqat API server manzili: https://api.domen.uz (yo'q: `/dashboard` qo'shmang — /api 404 bo'ladi).
 */
app.get('/config.client.js', (req, res) => {
    res.type('application/javascript; charset=utf-8');
    const apiBase = String(process.env.PUBLIC_API_BASE_URL || '')
        .trim()
        .replace(/\/+$/, '');
    const cfgObj = {
        apiBase,
        supabaseUrl: String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, ''),
        supabaseAnonKey: String(process.env.SUPABASE_ANON_KEY || '').trim(),
        paymentCheckoutUrl: String(process.env.PAYMENT_CHECKOUT_URL || '')
            .trim()
            .replace(/\/+$/, ''),
    };
    const cfgSerialized = JSON.stringify(cfgObj);
    const apiBaseLit = JSON.stringify(apiBase);
    res.send(`window.APP_CONFIG=${cfgSerialized};
window.apiUrl=function(p){p=String(p||"").trim();if(!p.startsWith("/"))p="/"+p;var b=${apiBaseLit};return b?b+p:p;};
`);
});

// 2. Diagnostika (bitta kirish nuqtasi)
app.get('/diagnostic', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'diagnostic-test.html'));
});
app.get('/diagnostic-test', (req, res) => {
    res.redirect(301, '/diagnostic');
});

// 3. Static fayllar uchun 'public' papkasini ulash
app.use(express.static(path.join(__dirname, 'public')));

// 4. Database ulanishi
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('🚀 EduNext AI bazaga ulandi!'))
    .catch(err => console.error('Baza ulanishida xato:', err));

// 5. API Routerlar
const aiRoutes = require('./routes/aiRoutes');
app.use('/api/ai', aiRoutes);

// 6. SPA — asosiy sahifa
function sendIndexHtml(req, res) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
}

app.get('/', sendIndexHtml);
app.get('/dashboard', sendIndexHtml);
app.get('/dashboard/writing', sendIndexHtml);
app.get('/dashboard/reading', sendIndexHtml);
app.get('/dashboard/vocabulary', sendIndexHtml);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`✅ Server http://localhost:${PORT} manzilida ishga tushdi`);
    const su = String(process.env.SUPABASE_URL || '').trim();
    const sk = String(process.env.SUPABASE_ANON_KEY || '').trim();
    if (!su || !sk) {
        console.warn(
            '⚠️  SUPABASE_URL yoki SUPABASE_ANON_KEY .env da bo‘sh — brauzerda /config.client.js Supabase ulanishsiz bo‘ladi (Dashboard Auth, profiles, kurslar).',
        );
    } else {
        console.log('✅ Supabase uchun /config.client.js sozlandi (URL mavjud, anon/publishable kalit mavjud).');
    }
});

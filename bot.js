/**
 * EduNextPay — Telegram bot (Grammy, reply keyboard).
 * Ishga tushirish: `npm run bot` yoki `node bot.js`
 *
 * ⚠️ Tokenni tirnoqlar ichiga yozing. Git uchun: bu faylni commit qilmang yoki .gitignore ga qo'shing.
 */
const { Bot, Keyboard } = require("grammy");

// SHU QATORNI TOPING VA O'ZGARTIRING:
const bot = new Bot("8794534891:AAEmID9xS0d-7tFTh785PIVF-qkNiiuE2ss");

bot.command("start", async (ctx) => {
  const keyboard = new Keyboard()
    .text("EduNext.site uchun obuna bo'lmoqchiman 🚀")
    .resized();

  await ctx.reply(`Assalomu Aleykum! EduNextpay botiga xush kelibsiz! 😊`, {
    reply_markup: keyboard,
  });
});

bot.hears("EduNext.site uchun obuna bo'lmoqchiman 🚀", async (ctx) => {
  const keyboard = new Keyboard().text("Obuna uchun pul to'ladim ✅").resized();

  await ctx.reply(
    `Ha, albatta! Mana to'lov ma'lumotlari:\n\n` +
      `💳 Karta raqami: 9860190109846567\n` +
      `👤 Egasi: Kamola Otaboyeva\n` +
      `💰 Obuna narxi: 20 000 so'm (1 oy)\n\n` +
      `👨‍💻 Admin: @@EduNextpayadmin\n\n` +
      `⚠️ To'lov qilganingizdan keyin chekni adminga tashlashni unutmang!`,
    { reply_markup: keyboard }
  );
});

bot.hears("Obuna uchun pul to'ladim ✅", async (ctx) => {
  await ctx.reply(
    `Rahmat! ✅ To'lovingiz 5 daqiqa ichida tekshiriladi va obunangiz faollashtiriladi. \n\nIltimos, adminga chek yuborganingizga ishonch hosil qiling!`,
    { reply_markup: { remove_keyboard: true } }
  );
});

bot.catch((err) => {
  console.error("[bot]", err.error ?? err);
});

bot.start();
console.log("Bot muvaffaqiyatli ishga tushdi...");

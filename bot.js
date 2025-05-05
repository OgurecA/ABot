const TelegramBot = require('node-telegram-bot-api');
const PDFDocument = require('pdfkit');
const fs = require('fs');

const token = '8067741459:AAF4VFQ5_ntev-6Yxwad0SO4b4xB4472Rxo';
const bot = new TelegramBot(token, { polling: true });

const QUESTIONS = [
  { text: 'Сколько лет вашему бизнесу?', type: 'number' },
  { text: 'Сколько сотрудников?', type: 'number' },
  { text: 'Годовая выручка (€)?', type: 'number' },
  { text: 'Годовые расходы (€)?', type: 'number' },
  { text: 'Есть управленческая команда?', type: 'bool' },
  { text: 'Есть системные процессы?', type: 'bool' },
  { text: 'Маркетинг работает постоянно?', type: 'bool' },
  { text: 'Отслеживаются ключевые KPI?', type: 'bool' },
  { text: 'Как часто принимаются стратегические решения?', type: 'choice' },
  { text: "Есть ощущение, что бизнес 'упёрся'?", type: 'bool' },
  { text: 'Есть ли несколько источников дохода?', type: 'bool' },
  { text: 'Есть ли высокая текучесть персонала?', type: 'bool' },
];


const userStates = {};

const YES_NO_KEYBOARD = {
  reply_markup: {
    keyboard: [['да', 'нет']],
    one_time_keyboard: true,
    resize_keyboard: true,
  },
};

const CHOICE_KEYBOARD = {
  reply_markup: {
    keyboard: [['ежемесячно', 'раз в год', 'по ситуации']],
    one_time_keyboard: true,
    resize_keyboard: true,
  },
};

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  userStates[chatId] = {
    step: 0,
    answers: [],
    messages: [msg.message_id],
  };
  askNextQuestion(chatId, msg.message_id);
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const state = userStates[chatId];

  if (!state || msg.text.startsWith('/')) return;

  state.messages.push(msg.message_id);

  const current = QUESTIONS[state.step];
  const text = msg.text.trim();

  if (current.type === 'number') {
    const num = parseFloat(text);
    if (isNaN(num) || num < 0) {
      const res = await bot.sendMessage(chatId, 'Введите положительное число:');
      state.messages.push(res.message_id);
      return;
    }
    state.answers.push(num);
  } else if (current.type === 'bool') {
    if (!['да', 'нет'].includes(text.toLowerCase())) {
      const res = await bot.sendMessage(chatId, 'Выберите \'да\' или \'нет\'.', YES_NO_KEYBOARD);
      state.messages.push(res.message_id);
      return;
    }
    state.answers.push(text);
  } else if (current.type === 'choice') {
    if (!['ежемесячно', 'раз в год', 'по ситуации'].includes(text.toLowerCase())) {
      const res = await bot.sendMessage(chatId, 'Выберите один из вариантов.', CHOICE_KEYBOARD);
      state.messages.push(res.message_id);
      return;
    }
    state.answers.push(text);
  }

  state.step++;

  if (state.step >= QUESTIONS.length) {
    for (const messageId of state.messages) {
      try { await bot.deleteMessage(chatId, messageId); } catch (e) { }
    }
    const analysis = analyzeBusiness(state.answers);

    // сообщение с кнопкой "Начать заново"
    await bot.sendMessage(chatId, analysis, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔁 Начать заново', callback_data: 'restart' }]
        ]
      }
    });

    // отправка PDF
    const pdfPath = `./Result.pdf`;
    await generateBusinessPDF(analysis, pdfPath, state.answers);
    await bot.sendDocument(chatId, pdfPath);
    fs.unlinkSync(pdfPath);

    delete userStates[chatId];
  } else {
    askNextQuestion(chatId);
  }
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  if (query.data === 'restart') {
    userStates[chatId] = {
      step: 0,
      answers: [],
      messages: []
    };
    await bot.sendMessage(chatId, 'Начинаем заново!');
    askNextQuestion(chatId);
  }
  await bot.answerCallbackQuery({ callback_query_id: query.id });
});

function askNextQuestion(chatId) {
  const state = userStates[chatId];
  const current = QUESTIONS[state.step];
  let keyboard = {};

  if (current.type === 'bool') keyboard = YES_NO_KEYBOARD;
  else if (current.type === 'choice') keyboard = CHOICE_KEYBOARD;
  else keyboard = { reply_markup: { remove_keyboard: true } };

  bot.sendMessage(chatId, current.text, keyboard).then((res) => {
    state.messages.push(res.message_id);
  });
}

function generateBusinessPDF(resultText, outputPath, answers) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({
      font: 'fonts/DejaVuSans.ttf',
      size: 'A4',
      margin: 50
    });

    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    doc.font('fonts/DejaVuSans.ttf');
    doc.fontSize(20).text('🧠 CORE-Скан бизнеса', { align: 'center' });
    doc.moveDown();

    doc.fontSize(14).text('Ответы пользователя:', { underline: true });
    QUESTIONS.forEach((q, index) => {
      const answer = answers[index] !== undefined ? answers[index] : '—';
      doc.fontSize(12).text(`${index + 1}. ${q.text} ${answer}`);
    });

    doc.moveDown();
    doc.fontSize(14).text('Результаты анализа:', { underline: true });
    doc.moveDown();
    doc.fontSize(12).text(resultText, { align: 'left', lineGap: 6 });

    doc.end();

    stream.on('finish', () => resolve(outputPath));
  });
}


function analyzeBusiness(ans) {
  try {
    const [years, staff, revenue, expenses, ...rest] = ans;
    const [team, processes, marketing, kpi, decisions, growth_block, income_sources, high_turnover] = rest.map((v, i) => {
      if (i === 4) return v.toLowerCase();
      return v.toLowerCase() === 'да';
    });

    let maturity_score = 1; // Начинаем с 1
    let risks = [];
    
    // 🧮 Расчет коэффициента по возрасту бизнеса
    const idealAge = 3;
    let ageCoefficient = 1;
    
    if (years < idealAge) {
      // Для бизнеса младше идеального возраста
      // От 0.85 при 0 лет до 1 при idealAge лет
      ageCoefficient = 0.85 + (0.15 * (years / idealAge));
    } else if (years > idealAge) {
      // Для бизнеса старше идеального возраста
      // От 1 при idealAge до 0.7 при 15+ лет
      const ageDiff = Math.min(years - idealAge, 12); // Разница максимум 12 лет (15 - 3)
      ageCoefficient = 1 - (0.3 * (ageDiff / 12));
    }
    
    // 🧮 Расчет коэффициента по количеству работников
    const idealStaff = 10;
    let staffCoefficient = 1;
    
    if (staff < 3) {
      staffCoefficient = 0.7;
      risks.push('мало сотрудников (<3)');
    } else if (staff < idealStaff) {
      // От 0.6 при 3 сотрудниках до 1 при 10 сотрудниках
      staffCoefficient = 0.7 + (0.4 * ((staff - 3) / (idealStaff - 3)));
    } else if (staff > 20) {
      // От 1 при 20 сотрудниках до 0.7 при большем количестве
      staffCoefficient = 0.8 + (0.3 * Math.max(0, (30 - staff) / 10));
      if (staff > 30) {
        staffCoefficient = 0.8;
        risks.push('избыточный штат сотрудников (>30)');
      }
    }
    
    // Применяем возрастной коэффициент и коэффициент количества сотрудников
    maturity_score *= ageCoefficient * staffCoefficient;
    
    if (years < 1) risks.push('молодой бизнес (<1 года)');
    if (years > 15) risks.push('устаревшая бизнес-модель (>15 лет)');

    const profit_margin = revenue > 0 ? ((revenue - expenses) / revenue) * 100 : 0;

    // Коэффициент от 0.4 (при 1%) до 1 (при 100%)
    let marginCoefficient = 1;

    if (profit_margin <= 1) {
      marginCoefficient = 0.4;
    } else if (profit_margin < 50) {
      marginCoefficient = 0.4 + 0.6 * ((profit_margin - 1) / 49);
    } else if (profit_margin > 50) {
      marginCoefficient = 1;
    }

    maturity_score *= marginCoefficient;

    if (profit_margin < 10) {
      risks.push('низкая маржинальность');
    }

    // Проверяем остальные параметры бизнеса
    if (!team) {
      maturity_score *= 0.9;
      risks.push('нет управленческой команды');
    }
    
    if (!processes) {
      maturity_score *= 0.9;
      risks.push('бизнес без системных процессов');
    }
    
    if (!marketing) {
      maturity_score *= 0.9;
      risks.push('отсутствует регулярный маркетинг');
    }
    
    if (!kpi) {
      maturity_score *= 0.9;
      risks.push('нет KPI');
    }

    if (decisions !== 'ежемесячно') {
      maturity_score *= 0.9;
      if (decisions !== 'раз в год') {
        risks.push('хаотичное принятие решений');
      }
    }

    if (growth_block) {
      maturity_score *= 0.9;
      risks.push('ощущается потолок роста');
    }

    if (!income_sources) {
      maturity_score *= 0.9;
      risks.push('единственный источник дохода');
    }

    if (high_turnover) {
      maturity_score *= 0.9;
      risks.push('высокая текучесть персонала');
    }


    level = '🔴';
    textLevel = 'КРАСНЫЙ';
    summary = 'Выживательная модель. Высокая зависимость от владельца. Требуется срочный пересмотр модели.';
    
    if (maturity_score > 0.85) {
      level = '🟢'; textLevel = 'ЗЕЛЁНЫЙ';
      summary = 'Высокая зрелость. Бизнес готов к масштабированию.';
    } else if (maturity_score > 0.65) {
      level = '🟡'; textLevel = 'ЖЁЛТЫЙ';
      summary = 'Бизнес стабильный, но не систематизированный. Требуется выверка ключевых процессов.';
    } else if (maturity_score > 0.40) {
      level = '🟠'; textLevel = 'ОРАНЖЕВЫЙ';
      summary = 'Бизнес хрупкий: отдельные элементы работают, но отсутствует целостная модель. Уязвим к внешним и внутренним рискам.';
    } else if (maturity_score > 0.25) {
      level = '🔴'; textLevel = 'КРАСНЫЙ';
      summary = 'Выживательная модель. Высокая зависимость от владельца. Требуется срочный пересмотр модели.';
    }
    
    return `🧠 CORE-Скан Завершён

Итоговый коэффициент: ${maturity_score.toFixed(2) * 100}/100
Уровень риска: ${level} ${textLevel}

📌 Вывод:
${summary}`;
  } catch (e) {
    return 'Произошла ошибка при анализе данных.';
  }
}

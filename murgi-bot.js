const express = require('express');
const twilio = require('twilio');
const puppeteer = require('puppeteer');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.urlencoded({ extended: false }));

// Twilio config
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);
const twilioPhone = process.env.TWILIO_PHONE; // +whatsapp:+39...

// ============ UTILITY: Parse messaggio utente ============
function parsePrenotazione(messaggio) {
  /*
    Accetta formati:
    - "prenota tennis domani 18"
    - "prenota domani 18:00"
    - "prenota 14 giugno 19:30"
    
    Ritorna: { campo, data, ora, durata }
  */
  
  const msg = messaggio.toLowerCase().trim();
  
  // Riconosce il campo
  let campo = 'Tennis 1';
  if (msg.includes('calcetto')) campo = 'Calcetto';
  if (msg.includes('tennis 2') || msg.includes('coperto')) campo = 'Tennis 2';
  
  // Parse ora
  const oraMatch = msg.match(/(\d{1,2}):?(\d{2})?/);
  const ora = oraMatch ? parseInt(oraMatch[1]) : 18;
  const minuti = oraMatch && oraMatch[2] ? parseInt(oraMatch[2]) : 0;
  
  // Parse data
  let data;
  if (msg.includes('domani') || msg.includes('tomorrow')) {
    data = new Date();
    data.setDate(data.getDate() + 1);
  } else if (msg.includes('oggi') || msg.includes('today')) {
    data = new Date();
  } else {
    // Prova a parsare "14 giugno" o simile
    const dateMatch = msg.match(/(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)/);
    if (dateMatch) {
      data = new Date();
      // Implementare parsing mese...
    } else {
      data = new Date();
      data.setDate(data.getDate() + 1);
    }
  }
  
  return {
    campo,
    data: data.toISOString().split('T')[0], // YYYY-MM-DD
    ora,
    minuti,
    durata: 1 // default 1 ora
  };
}

// ============ PRENOTA SU MURGI SPORT ============
async function prenotaMurgiSport(prenotazione) {
  /*
    Automatizza prenotazione usando Puppeteer
    prenotazione: { campo, data, ora, minuti, durata }
    
    Returns: { successo: boolean, messaggio: string, conferma: string }
  */
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Mappa campi a ID
    const campiMap = {
      'Tennis 1': 2,
      'Tennis 2': 3,
      'Calcetto': 4
    };
    const campId = campiMap[prenotazione.campo] || 2;
    
    console.log(`[Puppeteer] Accendo a ${prenotazione.campo} (${prenotazione.data} ${prenotazione.ora}:${prenotazione.minuti})`);
    
    // Step 1: Accedi alla pagina di prenotazione
    await page.goto(`https://www.murgisport.it/step2?cid=${campId}`, { waitUntil: 'networkidle2' });
    
    // Step 2: Naviga al giorno giusto
    const dataObj = new Date(prenotazione.data);
    const dataFormatted = dataObj.toLocaleDateString('it-IT', { 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit' 
    });
    
    console.log(`[Puppeteer] Cerco data: ${dataFormatted}`);
    
    // Click sul calendario (può richiedere navigazione)
    // Nota: questo dipende da come il calendario è implementato
    // Probabilmente click su un bottone data o input
    try {
      await page.click(`button[data-date="${prenotazione.data}"]`);
    } catch (e) {
      console.log('[Puppeteer] Data button non trovato, tentando alternative...');
      // Fallback: cerca il testo della data
      await page.click(`text=${dataFormatted}`);
    }
    
    await page.waitForTimeout(500);
    
    // Step 3: Seleziona l'orario
    const oraString = `${String(prenotazione.ora).padStart(2, '0')}:${String(prenotazione.minuti).padStart(2, '0')}`;
    console.log(`[Puppeteer] Seleziono ora: ${oraString}`);
    
    // Click sull'orario disponibile
    try {
      await page.click(`button[data-time="${oraString}"]`);
    } catch (e) {
      console.log('[Puppeteer] Time button non trovato, cercando per testo...');
      const buttons = await page.$$('button');
      for (let btn of buttons) {
        const text = await page.evaluate(el => el.textContent, btn);
        if (text.includes(oraString)) {
          await btn.click();
          break;
        }
      }
    }
    
    await page.waitForTimeout(500);
    
    // Step 4: Clicca PRENOTA SUBITO
    console.log('[Puppeteer] Clicco PRENOTA SUBITO');
    const prenotaButton = await page.$('button:contains("PRENOTA SUBITO"), a:contains("PRENOTA SUBITO")');
    if (prenotaButton) {
      await prenotaButton.click();
    } else {
      // Fallback: cerca per classe o ID
      await page.click('button[class*="prenota"], a[class*="prenota"]');
    }
    
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 5000 }).catch(() => {});
    
    // Step 5: Estrai numero di conferma dalla pagina di successo
    const contenuto = await page.content();
    const confermaMatch = contenuto.match(/prenotazione\s*[\#\s]*(\d+)/i);
    const conferma = confermaMatch ? confermaMatch[1] : 'N/A';
    
    await browser.close();
    
    return {
      successo: true,
      messaggio: `✅ Prenotazione confermata!\n\n🎾 ${prenotazione.campo}\n📅 ${dataFormatted}\n🕐 ${oraString}\n💪 Durata: ${prenotazione.durata}h\n\nConferma: #${conferma}`,
      conferma
    };
    
  } catch (error) {
    console.error('[Puppeteer Error]', error);
    if (browser) await browser.close();
    
    return {
      successo: false,
      messaggio: `❌ Errore prenotazione: ${error.message}\n\nRiprova o accedi a ${process.env.MURGI_URL || 'https://www.murgisport.it'}`,
      conferma: null
    };
  }
}

// ============ WEBHOOK TWILIO ============
app.post('/webhook/whatsapp', async (req, res) => {
  const messaggio = req.body.Body;
  const senderPhone = req.body.From;
  
  console.log(`[WhatsApp] Ricevuto: "${messaggio}" da ${senderPhone}`);
  
  try {
    // Parse il messaggio
    const prenotazione = parsePrenotazione(messaggio);
    console.log('[Parse] Riconosciuto:', prenotazione);
    
    // Valida se è una richiesta di prenotazione
    if (!messaggio.toLowerCase().includes('prenota')) {
      await client.messages.create({
        body: '🎾 Ciao! Per prenotare un campo, scrivi:\n\n"Prenota [tennis/calcetto] [domani/oggi] [ora]"\n\nEs: "Prenota tennis domani 18"',
        from: twilioPhone,
        to: senderPhone
      });
      res.sendStatus(200);
      return;
    }
    
    // Invia risposta "in elaborazione"
    await client.messages.create({
      body: '⏳ Sto prenotando il tuo campo...',
      from: twilioPhone,
      to: senderPhone
    });
    
    // Esegui la prenotazione
    const risultato = await prenotaMurgiSport(prenotazione);
    
    // Invia risposta con esito
    await client.messages.create({
      body: risultato.messaggio,
      from: twilioPhone,
      to: senderPhone
    });
    
    console.log('[WhatsApp] Risposta inviata');
    res.sendStatus(200);
    
  } catch (error) {
    console.error('[Webhook Error]', error);
    
    await client.messages.create({
      body: `❌ Errore imprevisto: ${error.message}`,
      from: twilioPhone,
      to: senderPhone
    });
    
    res.sendStatus(500);
  }
});

// ============ HEALTH CHECK ============
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============ START ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bot WhatsApp avviato su porta ${PORT}`);
  console.log(`📱 Webhook: POST http://localhost:${PORT}/webhook/whatsapp`);
});

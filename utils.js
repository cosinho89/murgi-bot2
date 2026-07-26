/**
 * Utility avanzate per parsing messaggi WhatsApp in italiano
 */

// Mappa mesi italiano → numero
const MESI = {
  'gennaio': 1, 'febbraio': 2, 'marzo': 3, 'aprile': 4,
  'maggio': 5, 'giugno': 6, 'luglio': 7, 'agosto': 8,
  'settembre': 9, 'ottobre': 10, 'novembre': 11, 'dicembre': 12
};

// Mappa giorni settimana
const GIORNI = {
  'lunedì': 1, 'martedì': 2, 'mercoledì': 3, 'giovedì': 4,
  'venerdì': 5, 'sabato': 6, 'domenica': 0
};

/**
 * Parse avanzato messaggi prenotazione
 * Esempi supportati:
 * - "prenota tennis domani 18"
 * - "prenota domani 18:30"
 * - "prenota 14 giugno 19:00"
 * - "prenota venerdì 20"
 * - "prenota tra 3 giorni 17"
 */
function parsePrenotazioneAvanzata(messaggio) {
  const msg = messaggio.toLowerCase().trim();
  
  // ===== RICONOSCI CAMPO =====
  let campo = 'Tennis 1';
  if (msg.includes('calcetto')) campo = 'Calcetto';
  else if (msg.includes('tennis 2') || msg.includes('coperto')) campo = 'Tennis 2';
  
  // ===== RICONOSCI ORA =====
  const oraMatch = msg.match(/(\d{1,2}):?(\d{2})?/);
  const ora = oraMatch ? parseInt(oraMatch[1]) : 18;
  const minuti = oraMatch && oraMatch[2] ? parseInt(oraMatch[2]) : 0;
  
  // Valida ora (0-23)
  if (ora < 0 || ora > 23) {
    throw new Error(`❌ Ora non valida: ${ora}. Usa formato 0-23.`);
  }
  
  // ===== RICONOSCI DATA =====
  let data = new Date();
  
  // Case 1: "domani"
  if (msg.includes('domani')) {
    data.setDate(data.getDate() + 1);
  }
  // Case 2: "oggi"
  else if (msg.includes('oggi')) {
    // Keep data = today
  }
  // Case 3: "tra X giorni"
  else if (msg.match(/tra\s+(\d+)\s+giorni?/)) {
    const match = msg.match(/tra\s+(\d+)\s+giorni?/);
    const giorni = parseInt(match[1]);
    data.setDate(data.getDate() + giorni);
  }
  // Case 4: Giorno settimana (lunedì, martedì, etc)
  else if (Object.keys(GIORNI).some(g => msg.includes(g))) {
    for (const [giornoNome, numeroDayOfWeek] of Object.entries(GIORNI)) {
      if (msg.includes(giornoNome)) {
        const today = new Date();
        const todayDayOfWeek = today.getDay();
        let daysToAdd = numeroDayOfWeek - todayDayOfWeek;
        
        // Se il giorno è nel passato questa settimana, vai prossima settimana
        if (daysToAdd <= 0) daysToAdd += 7;
        
        data.setDate(data.getDate() + daysToAdd);
        break;
      }
    }
  }
  // Case 5: "14 giugno" oppure "14/06"
  else {
    // Prova DD/MM
    const dateMatch1 = msg.match(/(\d{1,2})\/(\d{1,2})/);
    if (dateMatch1) {
      const giorno = parseInt(dateMatch1[1]);
      const mese = parseInt(dateMatch1[2]);
      data.setMonth(mese - 1);
      data.setDate(giorno);
    } else {
      // Prova "DD mese"
      const dateMatch2 = msg.match(/(\d{1,2})\s+(\w+)/);
      if (dateMatch2) {
        const giorno = parseInt(dateMatch2[1]);
        const meseTesto = dateMatch2[2].toLowerCase();
        const mese = MESI[meseTesto];
        
        if (mese) {
          data.setMonth(mese - 1);
          data.setDate(giorno);
        } else {
          throw new Error(`❌ Mese non riconosciuto: ${meseTesto}`);
        }
      } else {
        // Default: domani se nulla trovato
        data.setDate(data.getDate() + 1);
      }
    }
  }
  
  // Valida che data sia nel futuro (almeno oggi)
  const oggi = new Date();
  oggi.setHours(0, 0, 0, 0);
  data.setHours(0, 0, 0, 0);
  
  if (data < oggi) {
    throw new Error(`❌ Data nel passato: ${data.toLocaleDateString('it-IT')}`);
  }
  
  // ===== RICONOSCI DURATA =====
  let durata = 1; // default 1 ora
  const durataMatch = msg.match(/(\d+)\s*h(ora)?/i);
  if (durataMatch) {
    durata = parseInt(durataMatch[1]);
    if (durata < 1 || durata > 2) {
      throw new Error(`❌ Durata non valida: ${durata}h. Max 2 ore.`);
    }
  }
  
  return {
    campo,
    data: data.toISOString().split('T')[0], // YYYY-MM-DD
    ora,
    minuti,
    durata,
    dataFormattata: data.toLocaleDateString('it-IT', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  };
}

/**
 * Valida fascia oraria di disponibilità
 */
function validaFasciaOraria(ora, minuti) {
  // Murgi Sport apre presumibilmente 8:00-21:00
  const minimo = 8;
  const massimo = 21;
  
  if (ora < minimo || ora >= massimo) {
    return {
      valido: false,
      messaggio: `❌ Il circolo è aperto 8:00-21:00. Hai selezionato ${ora}:${String(minuti).padStart(2, '0')}`
    };
  }
  
  return { valido: true };
}

/**
 * Genera messaggio di conferma formattato
 */
function generaConferma(prenotazione, numeroConferma) {
  return `✅ **PRENOTAZIONE CONFERMATA**

🎾 **Campo**: ${prenotazione.campo}
📅 **Data**: ${prenotazione.dataFormattata}
🕐 **Orario**: ${String(prenotazione.ora).padStart(2, '0')}:${String(prenotazione.minuti).padStart(2, '0')}
⏱️ **Durata**: ${prenotazione.durata}h

🆔 **Numero Prenotazione**: #${numeroConferma}

Ti consigliamo di arrivare 10 minuti prima. 
Per cancellazioni: scrivi "cancella #${numeroConferma}"`;
}

/**
 * Gestisci errori di parsing
 */
function handleParseError(error) {
  console.error('[ParseError]', error.message);
  return `❌ ${error.message}\n\n💡 Prova così:\n"Prenota [tennis/calcetto] [domani/14 giugno/venerdì] [18:00]"`;
}

module.exports = {
  parsePrenotazioneAvanzata,
  validaFasciaOraria,
  generaConferma,
  handleParseError,
  MESI,
  GIORNI
};

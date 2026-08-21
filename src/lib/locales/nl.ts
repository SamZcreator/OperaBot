// Dutch.
//
// Typed against `en`, so a forgotten key will not compile. Two habits worth
// keeping when this grows:
//
//   - Address the reader as "je". This is a tool someone runs on their own
//     machine, not a bank; "u" would make it sound like paperwork.
//   - Translate the intent, not the words. English interface copy leans on
//     nouns where Dutch reads better with a verb, and a literal rendering is
//     what makes software feel translated rather than written.
import type { Dictionary } from "../i18n";

export const nl: Dictionary = {
  // ── gedeeld ─────────────────────────────────────────────────────────
  "common.loading": "Laden…",
  "common.cancel": "Annuleren",
  "common.save": "Opslaan",
  "common.close": "Sluiten",
  "common.appDefault": "Standaard van de app",

  // ── instellingen ────────────────────────────────────────────────────
  "settings.title": "Instellingen",
  "settings.language": "Taal",
  "settings.languageHint": "Geldt voor de app zelf. Bots antwoorden in de taal waarin je ze aanspreekt.",

  "settings.workingFolder": "Werkmap",
  "settings.workingFolderHint": "Hier voert deze bot zijn opdrachten en bestandsbewerkingen uit.",
  "settings.privateWorkspace": "Eigen werkruimte van de bot",
  "settings.privateWorkspaceOrPath": "Eigen werkruimte van de bot — of een volledig pad",

  "settings.purpose": "Waar deze bot voor is",
  "settings.purposePlaceholder": "Beschrijf wat deze bot doet",

  "settings.model": "Model",
  "settings.effort": "Denkkracht",
  "settings.autoMode": "Automatische modus",
  "settings.memory": "Geheugen",
  "settings.botMemory": "Geheugen van de bot",
  "settings.computer": "Computer",

  // De rol, niet de functietitel: deze bot houdt overzicht en verdeelt werk.
  // "Stafchef" klinkt als een organogram; "rechterhand" is wat het is.
  "settings.chiefOfStaff": "Rechterhand",
  "settings.onePerWorkspace": "Eén per werkruimte",
  "settings.askBeforeContacting": "Vraag het mij voordat andere bots benaderd worden",

  "settings.connectedApps": "Gekoppelde apps",
  "settings.allowConnectedApps": "Deze bot mag gekoppelde apps gebruiken",

  // ── stem ────────────────────────────────────────────────────────────
  "voice.botVoice": "Stem",
  "voice.currentVoice": "Huidige stem van de bot",
  "voice.loadingVoices": "Stemmen laden…",
  "voice.readAloud": "Antwoorden voorlezen",
  "voice.readThisBotAloud": "Antwoorden van deze bot voorlezen",

  // ── verbruik ────────────────────────────────────────────────────────
  "usage.title": "Verbruik",
  "usage.cost": "Kosten",
  "usage.tokens": "Tokens",
  "usage.turns": "Beurten",
  // ── mascotte ────────────────────────────────────────────────────────
  "mascot.expression": "Uitdrukking",
  "mascot.color": "Kleur",
  "mascot.reset": "Standaard",

  // ── botprofiel ──────────────────────────────────────────────────────
  "bot.name": "Naam",
  "bot.title": "Functie",
  "bot.description": "Omschrijving",

  // ── geheugen ────────────────────────────────────────────────────────
  "memory.hint": "Aantekeningen die deze bot tussen taken bewaart — gewone bestanden die je zelf kunt aanpassen.",
  "memory.overBudget": "Te groot — er wordt elke beurt alleen het begin van dit bestand geladen.",
  "memory.topicFiles": "Onderwerpen",
  "memory.clear": "Wissen",
  "memory.back": "Terug",

  // ── model ───────────────────────────────────────────────────────────
  "model.hint": "Welke aanbieder en welk model deze bot gebruikt",

  // ── meldingen ───────────────────────────────────────────────────────
  "notify.title": "Meldingen",
  "notify.hint": "Krijg bericht als deze bot klaar is of iets van je nodig heeft",
  "effort.hint": "Hoe diep deze bot nadenkt",
  "effort.noLevel": " (Standaard: er wordt geen niveau meegegeven)",

  // ── fase 2: zijbalk, gesprek, app-instellingen ──────────────────────
  "nav.newOrShare": "Nieuw of delen",
  "nav.newBot": "Nieuwe bot",
  "nav.teams": "Teams",
  "nav.search": "Zoeken",
  "nav.searchHint": "Zoek in bots en berichten",
  "nav.automations": "Automatiseringen",
  "nav.appSettings": "App-instellingen",
  "nav.undo": "Ongedaan maken",
  "room.new": "Nieuwe ruimte",
  "room.delete": "Ruimte verwijderen",
  "room.namePlaceholder": "Naam van de ruimte (optioneel)",
  "room.needsBot": "Maak eerst een bot — een ruimte bestaat uit bots.",
  "room.copyId": "Gespreks-ID kopiëren",
  "archive.title": "Gearchiveerde bots",
  "archive.hint": "Gesprekken blijven bewaard tot je een bot verwijdert.",
  "archive.restoreAll": "Alles terugzetten",
  "archive.restore": "Terugzetten",
  "archive.close": "Archief sluiten",
  "chat.copyMessage": "Bericht kopiëren",
  "chat.send": "Versturen",
  "chat.editMessage": "Bericht bewerken",
  "chat.webhookTask": "Webhook-taak",
  "chat.viewPayload": "Gegevens van de gebeurtenis bekijken",
  "chat.showFull": "Volledig bericht tonen",
  "chat.showLess": "Minder tonen",
  "chat.regenerate": "Opnieuw antwoorden",
  "chat.queued": "In de wachtrij — wordt verstuurd zodra deze beurt klaar is",
  "chat.previousVersion": "Vorige versie",
  "chat.nextVersion": "Volgende versie",
  "chat.botScreen": "Scherm van de bot",
  "chat.botSettings": "Botinstellingen",
  "chat.botComputer": "Computer van de bot",
  "chat.stopTurn": "Deze beurt stoppen",
  "chat.stop": "Stoppen",
  "chat.inspector": "Inspecteur",
  "chat.inspectorHint": "Inspecteur — gebeurtenissen en ruw protocol van dit gesprek",
  "chat.computerStarting": "De computer van deze bot wordt klaargezet…",
  "chat.jumpToLatest": "Naar de nieuwste berichten",
  "chat.discardQueued": "Bericht uit de wachtrij verwijderen",
  "chat.tagBot": "Een bot noemen",
  "app.yourName": "Je naam",
  "app.updates": "Updates",
  "app.closeSettings": "Instellingen sluiten",
  "app.profile": "Profiel",
  "app.profileHint": "Zichtbaar in de zijbalk. Wordt direct bewaard.",
  "app.connections": "Verbindingen",
  "app.connectorsReady": "De dienst voor gekoppelde apps is gereed",
  "app.selfHost": "Gekoppelde apps zelf hosten",
  "app.engineClis": "Engine-opdrachten",
  "app.engineClisHint": "Welk programma elke engine start. Wordt direct bewaard.",
  "section.general": "Algemeen",
  "section.connections": "Verbindingen",
  "section.engines": "Engines",
  "section.companion": "Telefoon",
  "section.computer": "Lokale VM",
  "section.voice": "Stem",
  "section.usage": "Verbruik",
  "chief.make": "Tot rechterhand maken",
  "chief.remove": "Rechterhand-rol weghalen",
  "chief.chooseAnother": "Kies eerst een andere rechterhand",
  "engine.chooseFirst": "Kies eerst een Claude- of ACP-engine",
  "profile.edit": "Profiel bewerken",
  "chat.empty": "Stuur een bericht om het gesprek te beginnen.",
  "chat.sendMessage": "Bericht versturen",
  "chat.sendsAfterTurn": "Wordt verstuurd zodra de huidige beurt klaar is",
  "dictation.stop": "Dicteren stoppen",
  "dictation.stopEsc": "Dicteren stoppen (Esc)",
};

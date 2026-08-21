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
};

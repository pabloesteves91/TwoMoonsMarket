#!/usr/bin/env node
/**
 * Prüft die Security Rules gegen den Firestore-Emulator.
 *
 * Die Rolle "store" ist eine Zugriffsbeschränkung – was die Oberfläche
 * ausblendet, ist Bequemlichkeit; verbindlich ist allein firestore.rules.
 * Deshalb wird hier nicht die App geprüft, sondern die Regel selbst: einmal,
 * dass das Verkaufskonto tun darf was es soll, und einmal, dass es alles
 * andere nicht darf.
 *
 * Start: npx firebase-tools emulators:exec --only firestore "node scripts/test-rules.mjs"
 */

import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';

const WS = 'twomoons';
const env = await initializeTestEnvironment({
  projectId: 'twomoons-rules-test',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});

/** Ausgangslage: zwei Konten, ein Bestandseintrag, zwei Verkäufe. */
const TAG = 24 * 60 * 60 * 1000;
const jetzt = Date.now();

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, `workspaces/${WS}/members/chefin`), { role: 'admin', email: 'info@twomoons.ch' });
  await setDoc(doc(db, `workspaces/${WS}/members/tresen`), { role: 'store', email: 'laden@twomoons.ch' });
  await setDoc(doc(db, `workspaces/${WS}/members/alt`), { email: 'ohne-rolle@twomoons.ch' });
  // In der Firebase-Konsole tippt sich "Store" leicht gross
  await setDoc(doc(db, `workspaces/${WS}/members/tresen2`), { role: 'Store', email: 'laden2@twomoons.ch' });
  // Und ein Rollenname, den es gar nicht gibt
  await setDoc(doc(db, `workspaces/${WS}/members/vertippt`), { role: 'verkauf', email: 'huch@twomoons.ch' });
  await setDoc(doc(db, `workspaces/${WS}/items/karte1`), {
    name: 'Heliod, Sun-Crowned', quantity: 3, purchasePrice: 12, updatedAt: jetzt,
  });
  await setDoc(doc(db, `workspaces/${WS}/sales/heute`), {
    name: 'Heliod', quantity: 1, unitPrice: 18.6, soldBy: 'tresen', soldAt: jetzt, itemId: 'karte1',
  });
  await setDoc(doc(db, `workspaces/${WS}/sales/gestern`), {
    name: 'Heliod', quantity: 1, unitPrice: 18.6, soldBy: 'tresen', soldAt: jetzt - 2 * TAG, itemId: 'karte1',
  });
  await setDoc(doc(db, `workspaces/${WS}/sales/fremd`), {
    name: 'Heliod', quantity: 1, unitPrice: 18.6, soldBy: 'chefin', soldAt: jetzt, itemId: 'karte1',
  });
  await setDoc(doc(db, `workspaces/${WS}/settings/settings`), { currency: 'CHF' });
  await setDoc(doc(db, `workspaces/${WS}/locations/vitrine`), { id: 'vitrine', name: 'Vitrine', sortIndex: 0 });
});

const tresen = env.authenticatedContext('tresen').firestore();
const chefin = env.authenticatedContext('chefin').firestore();
const alt = env.authenticatedContext('alt').firestore();
const fremder = env.authenticatedContext('niemand').firestore();
const tresenGross = env.authenticatedContext('tresen2').firestore();
const vertippt = env.authenticatedContext('vertippt').firestore();

let fehler = 0;
async function pruefe(name, versprechen) {
  try {
    await versprechen;
    console.log(`OK     ${name}`);
  } catch (err) {
    fehler++;
    console.log(`FEHLER ${name}: ${err.message.split('\n')[0]}`);
  }
}

console.log('=== Verkaufskonto: das soll gehen ===');
await pruefe('Bestand lesen', assertSucceeds(getDoc(doc(tresen, `workspaces/${WS}/items/karte1`))));
await pruefe('Menge ausbuchen', assertSucceeds(
  updateDoc(doc(tresen, `workspaces/${WS}/items/karte1`), { quantity: 2, updatedAt: Date.now() })));
await pruefe('Menge auf 0 setzen', assertSucceeds(
  updateDoc(doc(tresen, `workspaces/${WS}/items/karte1`), { quantity: 0, updatedAt: Date.now() })));
await pruefe('Verkauf auf eigenen Namen buchen', assertSucceeds(
  setDoc(doc(tresen, `workspaces/${WS}/sales/neu`), { soldBy: 'tresen', soldAt: Date.now(), quantity: 1 })));
await pruefe('eigenen Verkauf von heute zurücknehmen', assertSucceeds(
  deleteDoc(doc(tresen, `workspaces/${WS}/sales/heute`))));
await pruefe('Einstellungen lesen', assertSucceeds(getDoc(doc(tresen, `workspaces/${WS}/settings/settings`))));
await pruefe('Karte an einen anderen Lagerort umlagern', assertSucceeds(
  updateDoc(doc(tresen, `workspaces/${WS}/items/karte1`), { location: 'Event', updatedAt: Date.now() })));
await pruefe('Lagerorte lesen', assertSucceeds(getDoc(doc(tresen, `workspaces/${WS}/locations/vitrine`))));

console.log('\n=== Verkaufskonto: das soll nicht gehen ===');
await pruefe('Verkauf auf fremden Namen buchen', assertFails(
  setDoc(doc(tresen, `workspaces/${WS}/sales/untergeschoben`), { soldBy: 'chefin', soldAt: Date.now(), quantity: 1 })));
await pruefe('fremden Verkauf zurücknehmen', assertFails(
  deleteDoc(doc(tresen, `workspaces/${WS}/sales/fremd`))));
await pruefe('alten eigenen Verkauf zurücknehmen', assertFails(
  deleteDoc(doc(tresen, `workspaces/${WS}/sales/gestern`))));
await pruefe('gebuchten Verkauf nachträglich ändern', assertFails(
  updateDoc(doc(tresen, `workspaces/${WS}/sales/gestern`), { unitPrice: 1 })));
await pruefe('Einkaufspreis ändern', assertFails(
  updateDoc(doc(tresen, `workspaces/${WS}/items/karte1`), { purchasePrice: 1, updatedAt: Date.now() })));
await pruefe('Kartennamen ändern', assertFails(
  updateDoc(doc(tresen, `workspaces/${WS}/items/karte1`), { name: 'anders', updatedAt: Date.now() })));
await pruefe('Karte anlegen', assertFails(
  setDoc(doc(tresen, `workspaces/${WS}/items/neu`), { name: 'x', quantity: 1 })));
await pruefe('Karte löschen', assertFails(deleteDoc(doc(tresen, `workspaces/${WS}/items/karte1`))));
await pruefe('Lagerort anlegen', assertFails(
  setDoc(doc(tresen, `workspaces/${WS}/locations/neu`), { name: 'Heimlich', sortIndex: 9 })));
await pruefe('Lagerort umbenennen', assertFails(
  updateDoc(doc(tresen, `workspaces/${WS}/locations/vitrine`), { name: 'anders' })));
await pruefe('Einstellungen ändern', assertFails(
  setDoc(doc(tresen, `workspaces/${WS}/settings/settings`), { currency: 'EUR' })));
await pruefe('Preisregeln ändern', assertFails(
  setDoc(doc(tresen, `workspaces/${WS}/overrides/x`), { foil: {} })));
await pruefe('sich selbst zur Chefin machen', assertFails(
  setDoc(doc(tresen, `workspaces/${WS}/members/tresen`), { role: 'admin' })));

console.log('\n=== Leitung: unverändert alles erlaubt ===');
await pruefe('Karte anlegen', assertSucceeds(
  setDoc(doc(chefin, `workspaces/${WS}/items/neu2`), { name: 'x', quantity: 1, updatedAt: Date.now() })));
await pruefe('Einkaufspreis ändern', assertSucceeds(
  updateDoc(doc(chefin, `workspaces/${WS}/items/karte1`), { purchasePrice: 5 })));
await pruefe('alten Verkauf stornieren', assertSucceeds(
  deleteDoc(doc(chefin, `workspaces/${WS}/sales/gestern`))));
await pruefe('Einstellungen ändern', assertSucceeds(
  setDoc(doc(chefin, `workspaces/${WS}/settings/settings`), { currency: 'CHF' })));
await pruefe('Lagerort anlegen', assertSucceeds(
  setDoc(doc(chefin, `workspaces/${WS}/locations/event`), { id: 'event', name: 'Event', sortIndex: 1 })));

console.log('\n=== Konto ohne Rolle: wie bisher volle Rechte ausser Mitglieder ===');
await pruefe('Karte anlegen', assertSucceeds(
  setDoc(doc(alt, `workspaces/${WS}/items/neu3`), { name: 'x', quantity: 1, updatedAt: Date.now() })));
await pruefe('Mitglieder ändern', assertFails(
  setDoc(doc(alt, `workspaces/${WS}/members/tresen`), { role: 'admin' })));

console.log('\n=== Rolle "Store" gross geschrieben: gilt genauso ===');
await pruefe('Menge ausbuchen erlaubt', assertSucceeds(
  updateDoc(doc(tresenGross, `workspaces/${WS}/items/karte1`), { quantity: 1, updatedAt: Date.now() })));
await pruefe('Karte anlegen gesperrt', assertFails(
  setDoc(doc(tresenGross, `workspaces/${WS}/items/gross`), { name: 'x', quantity: 1 })));
await pruefe('Einstellungen ändern gesperrt', assertFails(
  setDoc(doc(tresenGross, `workspaces/${WS}/settings/settings`), { currency: 'EUR' })));

console.log('\n=== Unbekannte Rolle: lesen ja, ändern nein ===');
await pruefe('Bestand lesen', assertSucceeds(getDoc(doc(vertippt, `workspaces/${WS}/items/karte1`))));
await pruefe('Karte anlegen gesperrt', assertFails(
  setDoc(doc(vertippt, `workspaces/${WS}/items/x`), { name: 'x', quantity: 1 })));
await pruefe('Einstellungen ändern gesperrt', assertFails(
  setDoc(doc(vertippt, `workspaces/${WS}/settings/settings`), { currency: 'EUR' })));
await pruefe('Verkauf buchen gesperrt', assertFails(
  setDoc(doc(vertippt, `workspaces/${WS}/sales/x`), { soldBy: 'vertippt', soldAt: Date.now() })));

console.log('\n=== Konto ohne Freischaltung: nichts ===');
await pruefe('Bestand lesen', assertFails(getDoc(doc(fremder, `workspaces/${WS}/items/karte1`))));
await pruefe('Verkauf buchen', assertFails(
  setDoc(doc(fremder, `workspaces/${WS}/sales/x`), { soldBy: 'niemand', soldAt: Date.now() })));

await env.cleanup();
console.log(fehler === 0 ? '\nAlle Regeln greifen wie beabsichtigt' : `\n${fehler} Regelprüfungen fehlgeschlagen`);
process.exit(fehler ? 1 : 0);

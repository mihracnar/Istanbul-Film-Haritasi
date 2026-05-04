const SHEETS_BASE = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTXt4zT3CyoU90VGbFB8zUjGaqErL2l-CVSXoHE0JExFEDtCMoeEkZOsoR1ir3vLONtrspJAwG1kZSA/pub?output=csv";
const GID_FILMLER   = "0";
const GID_MEKANLAR  = "314226555";
const GID_GORSELLER = "1877749729";

// Katkı Formu — katki-formu.gs deploy edildikten sonra URL'yi buraya girin
const KATKI_API_URL = "https://script.google.com/macros/s/AKfycbxEovyoqLOBAHqy302fpkaELHWNBDrjMIzKrvR2oCBPioL1OLHu8fswOYsaDKYwYbNR3w/exec";

let FILMS = [];
let LOCS  = [];
// O(1) lookup maps — data.js'deki loadSheetsData() sonrası doldurulur
let FILM_MAP = {}; // id → film
let LOC_MAP  = {}; // id → loc

function buildLookupMaps(){
  FILM_MAP = Object.fromEntries(FILMS.map(f => [f.id, f]));
  LOC_MAP  = Object.fromEntries(LOCS.map(l  => [l.id, l]));
}
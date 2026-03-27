const SHEETS_BASE = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTXt4zT3CyoU90VGbFB8zUjGaqErL2l-CVSXoHE0JExFEDtCMoeEkZOsoR1ir3vLONtrspJAwG1kZSA/pub?output=csv";
const GID_FILMLER  = "0";
const GID_MEKANLAR = "314226555";

let FILMS = [];
let LOCS  = [];
// O(1) lookup maps — data.js'deki loadSheetsData() sonrası doldurulur
let FILM_MAP = {}; // id → film
let LOC_MAP  = {}; // id → loc

function buildLookupMaps(){
  FILM_MAP = Object.fromEntries(FILMS.map(f => [f.id, f]));
  LOC_MAP  = Object.fromEntries(LOCS.map(l  => [l.id, l]));
}
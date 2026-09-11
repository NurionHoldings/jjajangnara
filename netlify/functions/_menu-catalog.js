/**
 * RC1 Slice 1 — 서버 메뉴 원장 (단일 가격 SSOT)
 * 클라이언트 가격은 표시용이며 결제 기준이 아니다.
 */
"use strict";

const MINIMUM_ORDER_AMOUNT = 15000;
const ORDER_TTL_MS = 30 * 60 * 1000;
const MAX_LINE_QUANTITY = 20;
const MAX_ITEMS = 30;

const MENUS = Object.freeze({
  jjajang: { id: "jjajang", name: "짜장면", unitPrice: 8000, options: ["large"] },
  jjambbong: { id: "jjambbong", name: "짬뽕", unitPrice: 9000, options: ["large"] },
  jjamjja: { id: "jjamjja", name: "짬짜면", unitPrice: 9000, options: [] },
  kongguksu: { id: "kongguksu", name: "콩국수", unitPrice: 10000, options: ["large"] },
  "chadol-jjambbong": {
    id: "chadol-jjambbong",
    name: "차돌짬뽕",
    unitPrice: 12000,
    options: ["large"],
  },
  tangmini: { id: "tangmini", name: "미니탕수육", unitPrice: 12000, options: [] },
  tangjung: { id: "tangjung", name: "탕수육(중)", unitPrice: 17000, options: [] },
  jjambbongbap: { id: "jjambbongbap", name: "짬뽕밥", unitPrice: 10000, options: ["large"] },
  bokkeumbap: { id: "bokkeumbap", name: "볶음밥", unitPrice: 10000, options: ["large"] },
  mapabap: { id: "mapabap", name: "마파두부밥", unitPrice: 10000, options: [] },
  bibimbap: { id: "bibimbap", name: "중화비빔밥", unitPrice: 10000, options: ["large"] },
  jeyukbap: { id: "jeyukbap", name: "제육덮밥", unitPrice: 11000, options: ["large"] },
  japchaebap: { id: "japchaebap", name: "잡채밥", unitPrice: 11000, options: [] },
});

const OPTIONS = Object.freeze({
  large: { id: "large", name: "곱빼기", price: 1000 },
  double: { id: "double", name: "곱빼기", price: 1000 },
});

/** 세트 메인 슬롯 (빌더 m1~m7) */
const SET_MAINS = Object.freeze({
  m1: { id: "m1", name: "짜장면", extra: 0 },
  m2: { id: "m2", name: "짬뽕", extra: 0 },
  m3: { id: "m3", name: "짬짜면", extra: 1000 },
  m4: { id: "m4", name: "볶음밥", extra: 1000 },
  m5: { id: "m5", name: "중화비빔밥", extra: 1000 },
  m6: { id: "m6", name: "제육덮밥", extra: 2000 },
  m7: { id: "m7", name: "잡채밥", extra: 3000 },
});

const SETS = Object.freeze({
  solo: {
    id: "solo",
    name: "혼밥세트",
    basePrice: 16000,
    pick: 1,
    tangName: "초미니탕수육",
  },
  couple: {
    id: "couple",
    name: "달달커플세트",
    basePrice: 22000,
    pick: 2,
    tangName: "초미니탕수육",
  },
  family: {
    id: "family",
    name: "패밀리세트",
    basePrice: 31000,
    pick: 3,
    tangName: "미니탕수육",
  },
});

function getMenu(menuId) {
  return MENUS[menuId] || null;
}

function getOption(optionId) {
  return OPTIONS[optionId] || null;
}

function getSet(setId) {
  return SETS[setId] || null;
}

function getSetMain(mainId) {
  return SET_MAINS[mainId] || null;
}

module.exports = {
  MAXIMUM_ITEMS: MAX_ITEMS,
  MAX_LINE_QUANTITY,
  MINIMUM_ORDER_AMOUNT,
  MENUS,
  OPTIONS,
  ORDER_TTL_MS,
  SET_MAINS,
  SETS,
  getMenu,
  getOption,
  getSet,
  getSetMain,
};

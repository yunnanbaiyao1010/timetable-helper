/* =========================================================
   课表数据 · 孙维 2026-2027 学年第 1 学期
   来源：教务系统导出课表（打印时间 2026-11-07）
   days: 1=周一 … 7=周日
   ========================================================= */

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const mix = (...arrs) => [...new Set(arrs.flat())].sort((x, y) => x - y);

/* 节次时间，可在设置里改（默认按常见作息估算） */
const PERIODS = [
  { n: 1,  start: '08:00', end: '08:45' },
  { n: 2,  start: '08:55', end: '09:40' },
  { n: 3,  start: '10:00', end: '10:45' },
  { n: 4,  start: '10:55', end: '11:40' },
  { n: 5,  start: '14:00', end: '14:45' },
  { n: 6,  start: '14:55', end: '15:40' },
  { n: 7,  start: '16:00', end: '16:45' },
  { n: 8,  start: '16:55', end: '17:40' },
  { n: 9,  start: '19:00', end: '19:45' },
  { n: 10, start: '19:55', end: '20:40' },
];

const TOTAL_WEEKS = 16;

const COURSES = [
  {
    id: 'qt-base',
    name: 'Qt核心技术开发基础',
    short: 'Qt基础',
    teacher: '肖业清',
    theme: 'teal',
    sessions: [
      { days: [1], periods: [1, 2, 3, 4], weeks: range(1, 8), room: '四维东214-1', building: '四维大楼', type: '理论' },
      { days: [3], periods: [5, 6],      weeks: range(1, 8), room: '四维东214-1', building: '四维大楼', type: '理论' },
    ],
  },
  {
    id: 'qt-pro',
    name: 'Qt高级编程',
    short: 'Qt高级',
    teacher: '肖业清',
    theme: 'blue',
    sessions: [
      { days: [1], periods: [1, 2, 3, 4], weeks: mix(range(9, 11), range(13, 16)), room: '四维东214-1', building: '四维大楼', type: '理论' },
      { days: [1], periods: [1, 2, 3, 4], weeks: [12], room: '校内实训', building: '无楼号', type: '实训' },
      { days: [3], periods: [5, 6],      weeks: range(9, 16), room: '四维东214-1', building: '四维大楼', type: '理论' },
    ],
  },
  {
    id: 'db',
    name: '数据库应用开发',
    short: '数据库',
    teacher: '曾丽',
    theme: 'amber',
    sessions: [
      { days: [2], periods: [1, 2, 3, 4], weeks: mix(range(1, 10), [12]), room: '四维东214-1', building: '四维大楼', type: '理论' },
      { days: [2], periods: [1, 2, 3, 4], weeks: [11], room: '校内实训', building: '无楼号', type: '实训' },
    ],
  },
  {
    id: 'cpp',
    name: 'C++高级开发',
    short: 'C++',
    teacher: '燕敏',
    theme: 'red',
    sessions: [
      { days: [5], periods: [1, 2, 3, 4], weeks: mix(range(1, 10), [12]), room: '四维东214-1', building: '四维大楼', type: '理论' },
      { days: [5], periods: [1, 2, 3, 4], weeks: [11], room: '校内实训', building: '无楼号', type: '实训' },
    ],
  },
  {
    id: 'ai',
    name: 'AI大模型应用开发',
    short: 'AI大模型',
    teacher: '严新巧',
    theme: 'purple',
    sessions: [
      { days: [4], periods: [5, 6, 7, 8], weeks: mix(range(1, 10), [12]), room: '仁爱214', building: '仁爱大楼', type: '理论' },
      { days: [4], periods: [5, 6, 7, 8], weeks: [11], room: '校内实训', building: '无楼号', type: '实训' },
    ],
  },
  {
    id: 'training',
    name: '综合实训-1',
    short: '综合实训',
    teacher: '白俊鸽',
    theme: 'green',
    sessions: [
      { days: [2], periods: [5, 6, 7, 8], weeks: mix(range(9, 12), range(14, 16)), room: '四维东202', building: '四维大楼', type: '实践' },
      { days: [2], periods: [5, 6, 7, 8], weeks: [13], room: '校内实训', building: '无楼号', type: '实训' },
      { days: [3], periods: [7, 8],       weeks: range(9, 16), room: '四维东202', building: '四维大楼', type: '实践' },
    ],
  },
  {
    id: 'writing',
    name: '应用写作',
    short: '应用写作',
    teacher: '菅娜娜',
    theme: 'pink',
    sessions: [
      { days: [1], periods: [7, 8],  weeks: mix(range(2, 9), range(12, 13)), room: '仁爱107', building: '仁爱大楼', type: '理论' },
      { days: [3], periods: [9, 10], weeks: [12], room: '仁爱114', building: '仁爱大楼', type: '理论' },
      { days: [3], periods: [9, 10], weeks: [13], room: '仁爱109', building: '仁爱大楼', type: '理论' },
    ],
  },
  {
    id: 'policy',
    name: '形势与政策-5',
    short: '形势与政策',
    teacher: '张丽佳',
    theme: 'slate',
    sessions: [
      { days: [4], periods: [1, 2], weeks: [13, 15], room: '仁爱213', building: '仁爱大楼', type: '理论' },
    ],
  },
];

/* 楼栋之间步行估算（分钟） */
const BUILDING_WALK = {
  '四维大楼': { '仁爱大楼': 8 },
  '仁爱大楼': { '四维大楼': 8 },
};

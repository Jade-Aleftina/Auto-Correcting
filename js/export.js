export function downloadJson(filename, data) {
  downloadBlob(filename, JSON.stringify(data, null, 2), 'application/json');
}

export function downloadCsv(filename, rows) {
  const csv = rows.map(row => row.map(escapeCsv).join(',')).join('\r\n');
  const bom = '\uFEFF';
  downloadBlob(filename, bom + csv, 'text/csv;charset=utf-8');
}

export function resultToCsvRows(results) {
  const maxQuestion = results.reduce((max, result) => Math.max(max, result.details.length), 0);
  const headers = ['採点日時', 'テスト名', '受験番号', '合計点', '正答数', '誤答数', '未回答数'];
  for (let number = 1; number <= maxQuestion; number += 1) {
    headers.push(`問題${number}回答`, `問題${number}OCR`, `問題${number}確信度`, `問題${number}点`);
  }
  headers.push('誤答番号', '手動修正番号');

  const rows = [headers];
  results.forEach(result => {
    const row = [
      formatDateTime(result.gradedAt),
      result.testName,
      result.studentId || '',
      result.totalScore,
      result.correctCount,
      result.wrongCount,
      result.blankCount
    ];

    for (let number = 1; number <= maxQuestion; number += 1) {
      const detail = result.details.find(item => item.number === number) || {};
      row.push(
        detail.finalAnswer || '',
        detail.ocrAnswer || '',
        detail.ocrConfidence || '',
        detail.score ?? ''
      );
    }
    row.push((result.wrongNumbers || []).join(' '), (result.manualNumbers || []).join(' '));
    rows.push(row);
  });
  return rows;
}

export function formatDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function escapeCsv(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

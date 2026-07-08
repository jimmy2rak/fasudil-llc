/* ========================================
   parser.js — 文件解析器
   支持 xlsx/csv/pzfx/pdf/docx/image/JSON
   ======================================== */

const Parser = (() => {

  // --- 数据类型识别 ---
  const DATA_PATTERNS = {
    release: {
      keywords: ['释放', '溶出', 'release', 'dissolution', 'cumulative', '累积', 'time', '时间点'],
      numberColumns: 2, // 至少有一列时间和一列数值
      description: '释放度/溶出度曲线'
    },
    formulation: {
      keywords: ['处方', '配方', 'formulation', '组成', '组分', 'component', '植烷三醇', '油酸', '法舒地尔', 'fasudil'],
      description: '处方组成与含量'
    },
    ee_dl: {
      keywords: ['包封', '载药', 'encapsulation', 'loading', 'EE', 'DL', '游离', 'free', '总量', 'total'],
      description: '包封率/载药量'
    },
    residual: {
      keywords: ['残留', '残余', 'residual', 'remaining', '残余药量'],
      description: '释放残留率'
    },
    llc_saxs: {
      keywords: ['SAXS', '衍射', '散射', 'd-spacing', '晶面间距', 'q值'],
      description: 'LLC SAXS表征'
    },
    llc_rheo: {
      keywords: ['流变', '粘度', 'viscosity', 'rheology', '模量', 'G\'', 'G\'\''],
      description: 'LLC流变学'
    }
  };

  function detectDataType(parsedData) {
    // 基于列名/关键词自动识别数据类型
    if (!parsedData || !parsedData.columns) return { type: 'unknown', confidence: 0 };

    const colNames = parsedData.columns.map(c => c.toLowerCase());
    const allText = colNames.join(' ') + ' ' + (parsedData.rawText || '');

    let bestMatch = { type: 'unknown', confidence: 0 };

    for (const [type, pattern] of Object.entries(DATA_PATTERNS)) {
      let score = 0;
      for (const kw of pattern.keywords) {
        if (allText.includes(kw.toLowerCase())) score += 10;
      }
      if (score > bestMatch.confidence) {
        bestMatch = { type, confidence: score, description: pattern.description };
      }
    }

    return bestMatch;
  }

  // --- xlsx/csv 解析 (SheetJS) ---
  function parseXlsx(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array' });
          const sheets = {};

          for (const sheetName of wb.SheetNames) {
            const sheet = wb.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

            if (jsonData.length === 0) continue;

            // 提取列名和行数据
            const headers = jsonData[0];
            const rows = jsonData.slice(1).filter(row => row.some(cell => cell !== ''));

            sheets[sheetName] = {
              columns: headers,
              rows: rows,
              rowCount: rows.length,
              colCount: headers.length
            };
          }

          // 合并所有 sheet 的文本用于类型识别
          const allText = wb.SheetNames.map(name => {
            const s = sheets[name];
            return s.columns.join(' ');
          }).join(' ');

          const detection = detectDataType({ columns: Object.values(sheets)[0]?.columns || [], rawText: allText });

          resolve({
            format: 'xlsx',
            sheets,
            sheetNames: wb.SheetNames,
            detection,
            fileName: file.name
          });
        } catch (err) {
          reject(new Error(`xlsx 解析失败: ${err.message}`));
        }
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsArrayBuffer(file);
    });
  }

  function parseCsv(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target.result;
          const wb = XLSX.read(text, { type: 'string' });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

          const headers = jsonData[0];
          const rows = jsonData.slice(1).filter(row => row.some(cell => cell !== ''));

          const detection = detectDataType({ columns: headers, rawText: text });

          resolve({
            format: 'csv',
            sheets: { 'Sheet1': { columns: headers, rows, rowCount: rows.length, colCount: headers.length } },
            sheetNames: ['Sheet1'],
            detection,
            fileName: file.name
          });
        } catch (err) {
          reject(new Error(`csv 解析失败: ${err.message}`));
        }
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsText(file);
    });
  }

  // --- pzfx 解析 (DOMParser XML) ---
  function parsePzfx(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target.result;
          const doc = new DOMParser().parseFromString(text, 'text/xml');

          // 检查解析错误
          const parseError = doc.querySelector('parsererror');
          if (parseError) {
            reject(new Error('pzfx XML 解析失败: 格式不正确'));
            return;
          }

          const dataTables = doc.querySelectorAll('Table');
          const sheets = {};

          for (const table of dataTables) {
            const title = table.getAttribute('Title') || `Table-${dataTables.length}`;
            const columns = [];
            const rows = [];

            // 提取列定义
            const colDefs = table.querySelectorAll('Column');
            for (const col of colDefs) {
              columns.push(col.getAttribute('Title') || `Col-${columns.length + 1}`);
            }

            // 提取行数据
            const rowDefs = table.querySelectorAll('Row');
            for (const row of rowDefs) {
              const rowData = [];
              const cells = row.querySelectorAll('Cell');
              for (const cell of cells) {
                const val = cell.querySelector('Value');
                rowData.push(val ? parseFloat(val.textContent) || val.textContent : '');
              }
              rows.push(rowData);
            }

            sheets[title] = { columns, rows, rowCount: rows.length, colCount: columns.length };
          }

          const allText = Object.keys(sheets).join(' ') + ' ' +
            Object.values(sheets).map(s => s.columns.join(' ')).join(' ');

          const detection = detectDataType({
            columns: Object.values(sheets)[0]?.columns || [],
            rawText: allText
          });

          resolve({
            format: 'pzfx',
            sheets,
            sheetNames: Object.keys(sheets),
            detection,
            fileName: file.name
          });
        } catch (err) {
          reject(new Error(`pzfx 解析失败: ${err.message}`));
        }
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsText(file);
    });
  }

  // --- PDF 解析 (PDF.js) ---
  function parsePdf(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const pdf = await pdfjsLib.getDocument({ data }).promise;
          const texts = [];

          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            const pageText = content.items.map(item => item.str).join(' ');
            texts.push(pageText);
          }

          const fullText = texts.join('\n');

          // 尝试从 PDF 文本中提取数值表格
          const extractedData = extractNumericPairs(fullText);

          const detection = detectDataType({
            columns: extractedData.headers || [],
            rawText: fullText
          });

          resolve({
            format: 'pdf',
            pageCount: pdf.numPages,
            fullText,
            extractedData,
            detection,
            fileName: file.name,
            note: 'PDF 提取可能不完整，建议在导入预览中手动修正'
          });
        } catch (err) {
          reject(new Error(`PDF 解析失败: ${err.message}`));
        }
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsArrayBuffer(file);
    });
  }

  function extractNumericPairs(text) {
    // 从 PDF 文本中识别时间-释放率数据对
    const lines = text.split('\n').filter(l => l.trim());
    let headers = [];
    const rows = [];

    // 尝试识别包含数值的行
    for (const line of lines) {
      const nums = line.match(/[\d.]+/g);
      if (nums && nums.length >= 2) {
        rows.push(nums.map(n => parseFloat(n)));
      }
    }

    if (rows.length > 0) {
      headers = ['提取列1', '提取列2', ...(rows[0].length > 2 ? rows[0].slice(2).map((_, i) => `提取列${i + 3}`) : [])];
    }

    return { headers, rows, source: 'auto-extract' };
  }

  // --- Word (.docx) 解析 (mammoth.js) ---
  function parseDocx(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const result = await mammoth.convertToHtml({ arrayBuffer: e.target.result });
          const html = result.value;
          const warnings = result.messages;

          // 从 HTML 中提取纯文本
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = html;
          const plainText = tempDiv.textContent || tempDiv.innerText;

          // 尝试从 HTML 表格中提取数据
          const tables = [];
          const htmlTables = tempDiv.querySelectorAll('table');
          for (const table of htmlTables) {
            const headers = [];
            const rows = [];
            const ths = table.querySelectorAll('th');
            for (const th of ths) headers.push(th.textContent.trim());
            const trs = table.querySelectorAll('tr');
            for (const tr of trs) {
              const cells = tr.querySelectorAll('td');
              const rowData = [];
              for (const td of cells) rowData.push(td.textContent.trim());
              if (rowData.length > 0 && rowData.some(c => c !== '')) rows.push(rowData);
            }
            if (headers.length > 0 || rows.length > 0) {
              tables.push({ headers, rows });
            }
          }

          const detection = detectDataType({ columns: tables[0]?.headers || [], rawText: plainText });

          resolve({
            format: 'docx',
            html,
            plainText,
            tables,
            warnings,
            detection,
            fileName: file.name
          });
        } catch (err) {
          reject(new Error(`docx 解析失败: ${err.message}`));
        }
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsArrayBuffer(file);
    });
  }

  // --- 图片解析 ---
  function parseImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          resolve({
            format: 'image',
            width: img.width,
            height: img.height,
            size: file.size,
            mimeType: file.type,
            dataUrl: e.target.result,
            fileName: file.name,
            detection: { type: 'image', confidence: 100, description: '实验图像' }
          });
        };
        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsDataURL(file);
    });
  }

  // --- JSON 解析 ---
  function parseJson(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          resolve({
            format: 'json',
            data,
            fileName: file.name,
            detection: { type: 'json_import', confidence: 100, description: '系统数据导入' }
          });
        } catch (err) {
          reject(new Error(`JSON 解析失败: ${err.message}`));
        }
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsText(file);
    });
  }

  // --- 统一入口 ---
  function parseFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();

    switch (ext) {
      case 'xlsx': case 'xls':
        return parseXlsx(file);
      case 'csv':
        return parseCsv(file);
      case 'pzfx':
        return parsePzfx(file);
      case 'pdf':
        return parsePdf(file);
      case 'docx':
        return parseDocx(file);
      case 'doc':
        return Promise.resolve({
          format: 'doc',
          fileName: file.name,
          note: '旧版 Word (.doc) 格式无法在浏览器中直接解析，请用 Word 另存为 .docx 后再导入',
          detection: { type: 'doc_unsupported', confidence: 0 }
        });
      case 'png': case 'jpg': case 'jpeg': case 'gif': case 'bmp': case 'tiff': case 'tif': case 'webp':
        return parseImage(file);
      case 'json':
        return parseJson(file);
      default:
        return Promise.reject(new Error(`不支持 ${ext} 格式，请使用 xlsx/csv/pdf/docx/pzfx/image/json 文件`));
    }
  }

  // --- 将解析数据映射到实验结构 ---
  function mapToExperimentData(parsedResult, mapping) {
    // mapping: 用户在导入预览中指定的列映射
    // 例如: { timeCol: 0, releaseCol: 1, name: 'EXP-001' }

    if (!parsedResult.sheets) return null;

    const sheetName = mapping.sheetName || parsedResult.sheetNames[0];
    const sheetData = parsedResult.sheets[sheetName];

    if (!sheetData) return null;

    const result = {};

    // 根据数据类型映射
    switch (parsedResult.detection.type) {
      case 'release':
        result.release = {
          timePoints: [],
          cumulativeRelease: []
        };
        for (const row of sheetData.rows) {
          if (mapping.timeCol !== undefined && mapping.releaseCol !== undefined) {
            const t = parseFloat(row[mapping.timeCol]);
            const r = parseFloat(row[mapping.releaseCol]);
            if (!isNaN(t) && !isNaN(r)) {
              result.release.timePoints.push(t);
              result.release.cumulativeRelease.push(r);
            }
          }
        }
        result.release.medium = mapping.medium || 'PBS pH 7.4';
        break;

      case 'formulation':
        result.formulation = { components: [] };
        for (const row of sheetData.rows) {
          result.formulation.components.push({
            name: row[mapping.nameCol || 0] || '',
            amount: parseFloat(row[mapping.amountCol || 1]) || 0,
            unit: row[mapping.unitCol || 2] || 'mg'
          });
        }
        break;

      case 'ee_dl':
        result.ee_dl = {};
        for (const row of sheetData.rows) {
          // 提取 EE/DL 相关数据
          result.ee_dl.totalAmount = parseFloat(row[mapping.totalCol || 0]) || 0;
          result.ee_dl.freeAmount = parseFloat(row[mapping.freeCol || 1]) || 0;
          result.ee_dl.encapsulatedAmount = result.ee_dl.totalAmount - result.ee_dl.freeAmount;
          result.ee_dl.EE = (result.ee_dl.encapsulatedAmount / result.ee_dl.totalAmount * 100) || 0;
        }
        break;

      case 'residual':
        result.residual = {};
        for (const row of sheetData.rows) {
          result.residual.initialAmount = parseFloat(row[mapping.initialCol || 0]) || 0;
          result.residual.remainingAmount = parseFloat(row[mapping.remainingCol || 1]) || 0;
          result.residual.residualRate = (result.residual.remainingAmount / result.residual.initialAmount * 100) || 0;
        }
        break;

      default:
        // 未知类型，返回原始数据供用户手动处理
        result.raw = sheetData;
    }

    return result;
  }

  return {
    parseFile,
    detectDataType,
    mapToExperimentData,
    parseXlsx,
    parseCsv,
    parsePzfx,
    parsePdf,
    parseDocx,
    parseImage,
    parseJson
  };
})();

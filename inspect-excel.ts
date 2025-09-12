import XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

function inspectExcelFile(filePath: string) {
  console.log(`\n=== Inspecting: ${path.basename(filePath)} ===`);
  
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
  
  if (data.length === 0) {
    console.log('No data found in file');
    return;
  }
  
  // Show first 5 rows to understand structure
  console.log('\nFirst 5 rows (raw):');
  data.slice(0, 5).forEach((row, index) => {
    console.log(`Row ${index}:`, row.slice(0, 10)); // Show first 10 columns
  });
  
  // Try with header parsing
  const dataWithHeaders = XLSX.utils.sheet_to_json(sheet);
  if (dataWithHeaders.length > 0) {
    console.log('\nColumn names detected:');
    console.log(Object.keys(dataWithHeaders[0]));
    
    console.log('\nFirst 3 transactions:');
    dataWithHeaders.slice(0, 3).forEach((row, index) => {
      console.log(`\nTransaction ${index + 1}:`);
      Object.entries(row).forEach(([key, value]) => {
        if (value !== undefined && value !== '') {
          console.log(`  ${key}: ${value}`);
        }
      });
    });
  }
}

// Inspect all Excel files
const dataDir = path.join(process.cwd(), 'data');
const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.xlsx'));

files.forEach(file => {
  inspectExcelFile(path.join(dataDir, file));
});
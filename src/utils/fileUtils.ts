import * as xlsx from 'xlsx';
import fs from 'fs';
import path from 'path';

export const processUploadedFile = (file: Express.Multer.File): { fileLocation: string, tableReference: string } => {
    let fileLocation = file.path.replace(/\\/g, '/');
    const ext = path.extname(file.originalname).toLowerCase();

    if (ext === '.xlsx' || ext === '.xls') {
        const workbook = xlsx.readFile(fileLocation);
        const sheetName = workbook.SheetNames[0];
        const csvData = xlsx.utils.sheet_to_csv(workbook.Sheets[sheetName]);
        
        const newFileLocation = `${fileLocation}.csv`;
        fs.writeFileSync(newFileLocation, csvData);
        fs.unlinkSync(fileLocation); 
        
        return { fileLocation: newFileLocation, tableReference: `read_csv_auto('${newFileLocation}')` };
    } 
    
    if (ext === '.parquet') return { fileLocation, tableReference: `read_parquet('${fileLocation}')` };
    if (ext === '.json') return { fileLocation, tableReference: `read_json_auto('${fileLocation}')` };
    
    return { fileLocation, tableReference: `read_csv_auto('${fileLocation}')` };
};
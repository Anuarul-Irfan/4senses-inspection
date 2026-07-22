// ============================================================
// STÄRKEN 4-SENSES INSPECTION — Google Apps Script Backend
// (Fully Optimized & Bug-Fixed Version)
// ============================================================

const DRIVE_FOLDER_ID = '14zeNAjKqtJY26XUlkw8wdmC5Zi9K6HKQ';

const HEADERS = [
  'No.','Date','Time','Area','Machine','Area Owner','Shift','Inspector',
  'Sight\nOK','Sight\nNOT OK','Hearing\nOK','Hearing\nNOT OK',
  'Smell\nOK','Smell\nNOT OK','Touch\nOK','Touch\nNOT OK',
  'Total\nOK','Total\nNOT OK','Total\nN/A','Result',
  'Remarks / Issues',
  'Photo 1','Photo 2','Photo 3','Photo 4',
  'Notes','Submitted At'
];
const NUM_COLS = HEADERS.length; // 27

const ENG_COL_HEADERS = ['Eng\nClosure','Closed\nBy','Closed\nDate & Time','Action\nTaken','Evidence\nPhoto'];
const ENG_COL_START   = 28;
const TOTAL_COLS      = NUM_COLS + ENG_COL_HEADERS.length; // 32

const ENG_HEADERS = ['IssueKey','NOK Item','Action Taken','Photo URL','Closed By','Closed At','Submitted At'];

// Performance Caches
const _folderCache = {};
const _ssCache     = {};

// ============================================================
// doPost
// ============================================================
function doPost(e) {
  try {
    let body = e.postData ? e.postData.contents : '{}';
    if (e.postData && e.postData.type === 'application/x-www-form-urlencoded') {
      body = decodeURIComponent(e.postData.contents.replace(/^payload=/, ''));
    }
    const data   = JSON.parse(body);
    const action = data.action;
    
    if (action === 'submit')          return respond(submitRecord(data.record));
    if (action === 'getRecords')      return respond(getRecords(data.month));
    if (action === 'getYTD')          return respond(getYTD(data.year));
    if (action === 'generateMonthly') return respond(generateMonthly(data.month, data.closuresFromClient));
    if (action === 'syncAllClosures') return respond(syncAllClosures(data.month, data.closures));
    if (action === 'generateYTD')     return respond(generateYTD(data.year));
    if (action === 'deleteRecord')    return respond(deleteRecord(data.id, data.month));
    if (action === 'debug')           return respond(debugSheet(data.month));
    if (action === 'ping')            return respond({ status: 'OK', time: new Date().toISOString() });
    if (action === 'getEngClosures')  return respond(getEngClosures(data.month));
    if (action === 'saveEngClosure')  return respond(saveEngClosure(data));
    
    return respond({ error: 'Unknown action: ' + action });
  } catch (err) {
    return respond({ error: err.toString(), stack: err.stack });
  }
}

// ============================================================
// doGet
// ============================================================
function doGet(e) {
  let action = e.parameter.action;
  let month  = e.parameter.month || getCurrentMonth();
  let data   = {};
  if (e.parameter.payload) {
    try {
      data   = JSON.parse(e.parameter.payload);
      action = data.action || action;
      month  = data.month  || month;
    } catch(err) {}
  }
  if (action === 'getRecords')      return respond(getRecords(month));
  if (action === 'getYTD')          return respond(getYTD(e.parameter.year || data.year));
  if (action === 'generateMonthly') return respond(generateMonthly(month));
  if (action === 'generateYTD')     return respond(generateYTD(e.parameter.year || data.year));
  if (action === 'deleteRecord')    return respond(deleteRecord(data.id, month));
  if (action === 'debug')           return respond(debugSheet(month));
  if (action === 'ping')            return respond({ status: 'OK', time: new Date().toISOString() });

  // IF NO ACTION IS REQUESTED, SERVE THE HTML UI
  if (!action) {
    return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('4Senses Inspect')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
  }

  return respond({ status: 'OK', time: new Date().toISOString() });

}

function doOptions(e) {
  return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.TEXT);
}

// ============================================================
// GET YTD
// ============================================================
function getYTD(year) {
  if (!year) year = String(new Date().getFullYear());
  const rootFolder = getCachedFolder(DRIVE_FOLDER_ID);
  var allRecords = [];
  for (var m = 1; m <= 12; m++) {
    var month = year + '-' + ('0'+m).slice(-2);
    try {
      var result = getRecords(month);
      if (result.records && result.records.length > 0) allRecords = allRecords.concat(result.records);
    } catch(e) {}
  }
  var months = [];
  for (var m = 1; m <= 12; m++) {
    var month = year + '-' + ('0'+m).slice(-2);
    var mf = getFolderIfExists(rootFolder, month);
    if (mf) { var sf = getSheetFileIfExists(mf, 'Inspections_' + month); if (sf) months.push(month); }
  }
  return { records: allRecords, year: year, months: months, total: allRecords.length };
}

// ============================================================
// GENERATE MONTHLY REPORT
// ============================================================
function generateMonthly(month, closuresFromClient) {
  if (!month) month = getCurrentMonth();
  const rootFolder  = getCachedFolder(DRIVE_FOLDER_ID);
  const monthFolder = getOrCreateFolder(rootFolder, month);
  const recs        = getRecords(month).records;

  var driveClosures  = getEngClosures(month).closures || {};
  var clientClosures = closuresFromClient || {};
  var closures = {};
  Object.entries(driveClosures).forEach(function(e){ closures[e[0]] = e[1]; });
  Object.entries(clientClosures).forEach(function(e){
    var key = e[0], cl = e[1];
    if (cl && (cl.engineer || cl.actionTaken)) closures[key] = cl;
  });

  var driveCount  = Object.keys(driveClosures).length;
  var clientCount = Object.keys(clientClosures).length;
  var mergedCount = Object.keys(closures).length;
  Logger.log('generateMonthly: driveClosures='+driveCount+' clientClosures='+clientCount+' merged='+mergedCount);

  if (Object.keys(clientClosures).length > 0) {
    syncAllClosures(month, clientClosures); // Use optimized sync helper
  }

  const monthlySS = regenerateSummarySheet(monthFolder, month, recs, closures);

  var inspFile = getSheetFileIfExists(monthFolder, 'Inspections_' + month);
  if (inspFile) {
    var inspSS = SpreadsheetApp.open(inspFile);
    var oldEngTab = inspSS.getSheetByName('Eng Closures');
    if (oldEngTab && inspSS.getSheets().length > 1) {
      try { inspSS.deleteSheet(oldEngTab); } catch(e) {}
    }
  }

  try {
    var inspFile2 = getSheetFileIfExists(monthFolder, 'Inspections_' + month);
    if (inspFile2) {
      var inspSheet = SpreadsheetApp.open(inspFile2).getSheetByName('Records');
      if (inspSheet) {
        migrateAddEngColumns(inspSheet);
        var recClosureMap = {};
        Object.entries(closures).forEach(function(e) {
          var recId = String(e[0]).split('_')[0];
          if (!recClosureMap[recId]) recClosureMap[recId] = {};
          recClosureMap[recId][e[0]] = e[1];
        });
        Object.entries(recClosureMap).forEach(function(e) {
          updateInspRowClosure(monthFolder, month, e[0], e[1]);
        });
      }
    }
  } catch(e) {}

  const inspUrl = inspFile ? SpreadsheetApp.open(inspFile).getUrl() : '';
  return { success: true, month: month, totalRecords: recs.length, url: inspUrl,
           closuresTotal: mergedCount, closuresDrive: driveCount, closuresClient: clientCount };
}

// ============================================================
// GENERATE YTD REPORT
// ============================================================
function generateYTD(year) {
  if (!year) year = String(new Date().getFullYear());
  const rootFolder = getCachedFolder(DRIVE_FOLDER_ID);
  var allRecs = [], months = [], allClosures = {};
  for (var m = 1; m <= 12; m++) {
    var month = year + '-' + ('0'+m).slice(-2);
    var mf = getFolderIfExists(rootFolder, month);
    if (!mf) continue;
    var sf = getSheetFileIfExists(mf, 'Inspections_' + month);
    if (!sf) continue;
    months.push(month);
    delete _ssCache['ss_' + month];
    var res = getRecords(month);
    allRecs = allRecs.concat(res.records || []);
    var cl = getEngClosures(month).closures;
    Object.assign(allClosures, cl);
  }
  if (!allRecs.length) return { success: false, error: 'No records found for ' + year };

  var fname   = 'YTD_Report_' + year;
  var ytdFile = getSheetFileIfExists(rootFolder, fname);
  var ss;
  if (!ytdFile) {
    ss = SpreadsheetApp.create(fname);
    var f = DriveApp.getFileById(ss.getId());
    rootFolder.addFile(f); DriveApp.getRootFolder().removeFile(f);
    f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } else {
    ss = SpreadsheetApp.open(ytdFile);
  }

  var updatedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  var titleBg = '#1F3864', titleFc = '#FFFFFF', hdrBg = '#2E75B6', hdrFc = '#FFFFFF';
  var senses  = ['sight','hear','smell','touch'];
  var sLabels = ['Sight','Hearing','Smell','Touch'];

  function getOrResetSheet(name, pos) {
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name, pos);
    else { sh.clearContents(); sh.clearFormats(); }
    return sh;
  }
  function styleTitle(sh, row, cols, text) {
    sh.getRange(row,1,1,cols).merge().setValue(text).setBackground(titleBg).setFontColor(titleFc)
      .setFontWeight('bold').setFontSize(12).setHorizontalAlignment('center');
    sh.setRowHeight(row, 32);
  }
  function styleHeader(sh, row, cols, vals) {
    sh.getRange(row,1,1,cols).setValues([vals]).setBackground(hdrBg).setFontColor(hdrFc)
      .setFontWeight('bold').setHorizontalAlignment('center').setFontSize(9);
  }

  // TAB 1: YTD Summary
  var s1 = getOrResetSheet('YTD Summary', 0);
  var totalOK  = allRecs.reduce(function(a,r){return a+(r.totalOK||0);},0);
  var totalNOK = allRecs.reduce(function(a,r){return a+(r.totalNOK||0);},0);
  var passRecs = allRecs.filter(function(r){return r.pass;}).length;
  var passRate = (totalOK+totalNOK)?Math.round(totalOK/(totalOK+totalNOK)*100):0;
  var allF     = countFindings(allRecs, allClosures);
  var clPctAll = allF.total ? Math.round(allF.closed/allF.total*100) : 100;
  var r=1;
  styleTitle(s1,r,4,'STARKEN — YTD SUMMARY : '+year+'   |   Updated: '+updatedAt); r+=2;
  s1.getRange(r,1,1,4).merge().setValue('OVERALL KPIs').setBackground(hdrBg).setFontColor(hdrFc).setFontWeight('bold'); r++;
  [
    ['Total Inspections', allRecs.length, 'Pass Rate', passRate+'%'],
    ['PASS', passRecs, 'FAIL', allRecs.length-passRecs],
    ['Items OK', totalOK, 'Items NOT OK', totalNOK],
    ['NOK Findings', allF.total, 'Eng Closed', allF.closed+' / '+allF.total+' ('+clPctAll+'%)']
  ].forEach(function(row){
    s1.getRange(r,1,1,4).setValues([row]);
    s1.getRange(r,1).setFontWeight('bold').setBackground('#D9E1F2');
    s1.getRange(r,3).setFontWeight('bold').setBackground('#D9E1F2');
    s1.getRange(r,2).setHorizontalAlignment('center');
    s1.getRange(r,4).setHorizontalAlignment('center').setFontWeight('bold'); r++;
  }); r++;
  s1.getRange(r,1,1,4).merge().setValue('OK RATE BY SENSE').setBackground(hdrBg).setFontColor(hdrFc).setFontWeight('bold'); r++;
  styleHeader(s1,r,4,['Sense','Items OK','Items NOT OK','OK Rate']); r++;
  senses.forEach(function(s,i){
    var ok  = allRecs.reduce(function(a,rec){return a+(rec.senseScores&&rec.senseScores[s]?rec.senseScores[s].ok:0);},0);
    var nok = allRecs.reduce(function(a,rec){return a+(rec.senseScores&&rec.senseScores[s]?rec.senseScores[s].nok:0);},0);
    var rt  = (ok+nok)?Math.round(ok/(ok+nok)*100):100;
    s1.getRange(r,1,1,4).setValues([[sLabels[i],ok,nok,rt+'%']]);
    s1.getRange(r,4).setFontColor(rt>=90?'#1a5c2a':rt>=70?'#7d4e00':'#9b1c1c').setFontWeight('bold');
    s1.getRange(r,2,1,3).setHorizontalAlignment('center'); r++;
  }); r++;
  var areaMap={};
  allRecs.forEach(function(rec){var a=rec.area||'Unknown';if(!areaMap[a])areaMap[a]={total:0,pass:0,nok:0};areaMap[a].total++;if(rec.pass)areaMap[a].pass++;areaMap[a].nok+=(rec.totalNOK||0);});
  s1.getRange(r,1,1,4).merge().setValue('AREA BREAKDOWN').setBackground(hdrBg).setFontColor(hdrFc).setFontWeight('bold'); r++;
  styleHeader(s1,r,5,['Area','Inspections','PASS','Items NOK','Pass Rate']); r++;
  Object.entries(areaMap).sort(function(a,b){return b[1].total-a[1].total;}).forEach(function(entry){
    var nm=entry[0],d=entry[1],rt= d.total?Math.round(d.pass/d.total*100):0;
    s1.getRange(r,1,1,5).setValues([[nm,d.total,d.pass,d.nok,rt+'%']]);
    s1.getRange(r,2,1,4).setHorizontalAlignment('center');
    s1.getRange(r,5).setFontColor(rt>=90?'#1a5c2a':'#9b1c1c').setFontWeight('bold'); r++;
  });
  [160,120,80,80,100].forEach(function(w,i){s1.setColumnWidth(i+1,w);}); s1.setFrozenRows(1);

  // TAB 2: Monthly Summary
  var s2 = getOrResetSheet('Monthly Summary',1); r=1;
  styleTitle(s2,r,8,'MONTHLY BREAKDOWN : '+year); r+=2;
  styleHeader(s2,r,8,['Month','Inspections','PASS','FAIL','Items OK','Pass Rate','NOK Findings','Eng Closure %']); r++;
  months.forEach(function(month){
    var mr   = allRecs.filter(function(rec){return rec.date.startsWith(month);});
    var mOK  = mr.reduce(function(a,rec){return a+(rec.totalOK||0);},0);
    var mNOK = mr.reduce(function(a,rec){return a+(rec.totalNOK||0);},0);
    var mPass= mr.filter(function(rec){return rec.pass;}).length;
    var mRate= (mOK+mNOK)?Math.round(mOK/(mOK+mNOK)*100):0;
    var mF   = countFindings(mr, allClosures);
    var clPct= mF.total ? Math.round(mF.closed/mF.total*100) : 100;
    s2.getRange(r,1,1,8).setValues([[month,mr.length,mPass,mr.length-mPass,mOK,mRate+'%',mF.total,clPct+'%']]);
    s2.getRange(r,2,1,7).setHorizontalAlignment('center');
    s2.getRange(r,6).setFontColor(mRate>=90?'#1a5c2a':mRate>=70?'#7d4e00':'#9b1c1c').setFontWeight('bold');
    s2.getRange(r,8).setFontColor(clPct===100?'#1a5c2a':clPct>=50?'#7d4e00':'#9b1c1c').setFontWeight('bold');
    s2.getRange(r,1,1,8).setBackground(mRate>=90?'#E2EFDA':mRate>=70?'#FFEB9C':'#FCE4D6'); r++;
  });
  [120,100,80,80,80,90,100,110].forEach(function(w,i){s2.setColumnWidth(i+1,w);}); s2.setFrozenRows(3);

  // TAB 3: All Records
  var s3 = getOrResetSheet('All Records',2);
  var recHdrs=['No.','Date','Time','Area','Machine','Area Owner','Shift','Inspector',
    'Sight OK','Sight NOK','Hear OK','Hear NOK','Smell OK','Smell NOK','Touch OK','Touch NOK',
    'Total OK','Total NOK','Total N/A','Result','Remarks','Notes',
    'NOK Items','Eng Closure','Closed By','Closed Date','Action Taken','Evidence'];
  r=1; styleTitle(s3,r,recHdrs.length,'ALL INSPECTION RECORDS  |  '+year); r++;
  styleHeader(s3,r,recHdrs.length,recHdrs); r++;
  allRecs.forEach(function(rec,i){
    var rf = getRecordFindings(rec, allClosures);
    var closedItems = rf.filter(function(f){return f.isClosed;});
    var clStatus = rf.length===0?'—':closedItems.length+'/'+rf.length+' closed';
    var vals=[i+1,rec.date,rec.time||'',rec.area||'',rec.machine||'',rec.supervisor||'',rec.shift||'',rec.inspector||'',
      rec.senseScores&&rec.senseScores.sight?rec.senseScores.sight.ok:0,
      rec.senseScores&&rec.senseScores.sight?rec.senseScores.sight.nok:0,
      rec.senseScores&&rec.senseScores.hear?rec.senseScores.hear.ok:0,
      rec.senseScores&&rec.senseScores.hear?rec.senseScores.hear.nok:0,
      rec.senseScores&&rec.senseScores.smell?rec.senseScores.smell.ok:0,
      rec.senseScores&&rec.senseScores.smell?rec.senseScores.smell.nok:0,
      rec.senseScores&&rec.senseScores.touch?rec.senseScores.touch.ok:0,
      rec.senseScores&&rec.senseScores.touch?rec.senseScores.touch.nok:0,
      rec.totalOK||0,rec.totalNOK||0,rec.totalNA||0,rec.pass?'PASS':'FAIL',
      rec.remarks?Object.entries(rec.remarks).filter(function(e){return e[1];}).map(function(e){return e[0]+': '+e[1];}).join(' | '):'',
      rec.notes||'',rf.length||'',clStatus,
      closedItems.map(function(f){return f.closure.engineer||'';}).join(', '),
      closedItems.map(function(f){return (f.closure.closedAt||'').slice(0,10);}).join(', '),
      closedItems.map(function(f){return f.closure.actionTaken||'';}).join(' | '),
      closedItems.map(function(f){return f.closure.photo||'';}).filter(Boolean).join(', ')
    ];
    s3.getRange(r,1,1,recHdrs.length).setValues([vals]).setBackground(rec.pass?'#E2EFDA':'#FCE4D6').setFontSize(9);
    s3.getRange(r,20).setFontWeight('bold').setFontColor(rec.pass?'#1a5c2a':'#9b1c1c');
    s3.getRange(r,9,1,12).setHorizontalAlignment('center'); r++;
  });
  [50,100,60,90,120,100,120,90,60,60,60,60,60,60,60,60,65,65,65,70,200,150,60,90,90,90,200,130].forEach(function(w,i){s3.setColumnWidth(i+1,w);}); s3.setFrozenRows(2);

  // TAB 4: Machine Breakdown
  var s4 = getOrResetSheet('Machine Breakdown',3); r=1;
  styleTitle(s4,r,7,'MACHINE BREAKDOWN : '+year); r+=2;
  styleHeader(s4,r,7,['Area','Machine','Inspections','PASS','Items NOK','Pass Rate','Eng Closure %']); r++;
  var machMap={};
  allRecs.forEach(function(rec){
    var k=(rec.area||'?')+'||'+(rec.machine||'?');
    if(!machMap[k])machMap[k]={area:rec.area||'',machine:rec.machine||'',total:0,pass:0,nok:0,findings:0,closed:0};
    machMap[k].total++;if(rec.pass)machMap[k].pass++;machMap[k].nok+=(rec.totalNOK||0);
    var rf=getRecordFindings(rec,allClosures);
    machMap[k].findings+=rf.length;
    machMap[k].closed+=rf.filter(function(f){return f.isClosed;}).length;
  });
  Object.values(machMap).sort(function(a,b){return b.nok-a.nok;}).forEach(function(m){
    var rt= m.total?Math.round(m.pass/m.total*100):0;
    var clPct=m.findings?Math.round(m.closed/m.findings*100):100;
    s4.getRange(r,1,1,7).setValues([[m.area,m.machine,m.total,m.pass,m.nok,rt+'%',clPct+'%']]).setBackground(rt>=90?'#E2EFDA':rt>=70?'#FFEB9C':'#FCE4D6');
    s4.getRange(r,3,1,5).setHorizontalAlignment('center');
    if(m.nok>0)s4.getRange(r,5).setFontColor('#9b1c1c').setFontWeight('bold');
    s4.getRange(r,6).setFontColor(rt>=90?'#1a5c2a':'#9b1c1c').setFontWeight('bold');
    s4.getRange(r,7).setFontColor(clPct===100?'#1a5c2a':clPct>=50?'#7d4e00':'#9b1c1c').setFontWeight('bold'); r++;
  });
  [120,160,90,80,90,90,110].forEach(function(w,i){s4.setColumnWidth(i+1,w);}); s4.setFrozenRows(3);

  // TAB 5: Area Breakdown
  var s5 = getOrResetSheet('Area Breakdown',4); r=1;
  styleTitle(s5,r,7,'AREA BREAKDOWN : '+year); r+=2;
  styleHeader(s5,r,7,['Area','Area Owner','Inspections','PASS','Items NOK','Pass Rate','Eng Closure %']); r++;
  var areaOwnerMap={'Batching':'Zul','Precure':'Zul','MTS':'Zul','Cutting':'Ramesh','Autoclave':'Sam','Packing':'Fikri','Panel Assy':'Logen','Others':'Yong'};
  var areaFindMap={};
  allRecs.forEach(function(rec){
    var a=rec.area||'Unknown';
    if(!areaFindMap[a])areaFindMap[a]={findings:0,closed:0};
    var rf=getRecordFindings(rec,allClosures);
    areaFindMap[a].findings+=rf.length;
    areaFindMap[a].closed+=rf.filter(function(f){return f.isClosed;}).length;
  });
  Object.entries(areaMap).sort(function(a,b){return b[1].total-a[1].total;}).forEach(function(entry){
    var nm=entry[0],d=entry[1],rt= d.total?Math.round(d.pass/d.total*100):0;
    var af=areaFindMap[nm]||{findings:0,closed:0};
    var clPct=af.findings?Math.round(af.closed/af.findings*100):100;
    s5.getRange(r,1,1,7).setValues([[nm,areaOwnerMap[nm]||'',d.total,d.pass,d.nok,rt+'%',clPct+'%']]).setBackground(rt>=90?'#E2EFDA':rt>=70?'#FFEB9C':'#FCE4D6');
    s5.getRange(r,3,1,5).setHorizontalAlignment('center');
    s5.getRange(r,6).setFontColor(rt>=90?'#1a5c2a':'#9b1c1c').setFontWeight('bold');
    s5.getRange(r,7).setFontColor(clPct===100?'#1a5c2a':clPct>=50?'#7d4e00':'#9b1c1c').setFontWeight('bold'); r++;
  });
  [140,100,100,80,90,90,110].forEach(function(w,i){s5.setColumnWidth(i+1,w);}); s5.setFrozenRows(3);

  // TAB 6: Inspector Breakdown
  var s6 = getOrResetSheet('Inspector Breakdown',5); r=1;
  styleTitle(s6,r,6,'INSPECTOR BREAKDOWN : '+year); r+=2;
  styleHeader(s6,r,6,['Inspector','Inspections','PASS','Items NOK','Pass Rate','Eng Closures Done']); r++;
  var inspMap={};
  allRecs.forEach(function(rec){
    var n=rec.inspector||'Unknown';
    if(!inspMap[n])inspMap[n]={total:0,pass:0,nok:0};
    inspMap[n].total++;if(rec.pass)inspMap[n].pass++;inspMap[n].nok+=(rec.totalNOK||0);
  });
  var engClosedMap={};
  Object.values(allClosures).forEach(function(cl){
    var eng=cl.engineer||'Unknown';
    if(!engClosedMap[eng])engClosedMap[eng]=0; engClosedMap[eng]++;
  });
  Object.entries(inspMap).sort(function(a,b){return b[1].total-a[1].total;}).forEach(function(entry){
    var nm=entry[0],d=entry[1],rt= d.total?Math.round(d.pass/d.total*100):0;
    s6.getRange(r,1,1,6).setValues([[nm,d.total,d.pass,d.nok,rt+'%',engClosedMap[nm]||0]]).setBackground(rt>=90?'#E2EFDA':rt>=70?'#FFEB9C':'#FCE4D6');
    s6.getRange(r,2,1,5).setHorizontalAlignment('center');
    s6.getRange(r,5).setFontColor(rt>=90?'#1a5c2a':'#9b1c1c').setFontWeight('bold'); r++;
  });
  [140,100,80,90,90,120].forEach(function(w,i){s6.setColumnWidth(i+1,w);}); s6.setFrozenRows(3);

  // TAB 7: Eng Closures
  addEngClosuresTab(ss, allClosures, allRecs, 'ENG CLOSURES — ' + year, 6);

  ss.getSheets().forEach(function(sh){var n=sh.getName();if(n==='Sheet1'||n==='Sheet2'||n==='Sheet3'){try{ss.deleteSheet(sh);}catch(e){}}});
  return { success: true, year: year, totalRecords: allRecs.length, url: ss.getUrl() };
}

// ============================================================
// ADD ENG CLOSURES TAB
// ============================================================
function addEngClosuresTab(ss, closures, recs, title, pos) {
  var shName = 'Eng Closures';
  var sh = ss.getSheetByName(shName);
  if (!sh) {
    sh = (pos !== undefined) ? ss.insertSheet(shName, pos) : ss.insertSheet(shName);
  } else { sh.clearContents(); sh.clearFormats(); }

  var titleBg = '#1F3864', hdrBg = '#2E75B6';
  var cols = ['No.','Inspection Date','Time','Area','Machine','Inspector',
              'NOK Item','Closed By','Closed Date','Closed Time','Action Taken','Evidence'];
  var ncols = cols.length;

  sh.getRange(1,1,1,ncols).merge().setValue(title)
    .setBackground(titleBg).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(12).setHorizontalAlignment('center');
  sh.setRowHeight(1, 32);
  sh.getRange(2,1,1,ncols).setValues([cols]).setBackground(hdrBg).setFontColor('#FFFFFF')
    .setFontWeight('bold').setFontSize(9).setHorizontalAlignment('center');
  sh.setRowHeight(2, 28);

  var recById = {};
  recs.forEach(function(rec){ recById[rec.id] = rec; });

  var rows = [];
  Object.entries(closures).forEach(function(entry) {
    var issueKey = entry[0], cl = entry[1];
    var recId    = issueKey.split('_')[0];
    var rec      = recById[recId] || {};
    var closedDt = cl.closedAt ? new Date(cl.closedAt) : null;
    var closedDate = closedDt ? Utilities.formatDate(closedDt, Session.getScriptTimeZone(), 'yyyy-MM-dd') : '';
    var closedTime = closedDt ? Utilities.formatDate(closedDt, Session.getScriptTimeZone(), 'HH:mm')      : '';
    rows.push([0, rec.date||'', rec.time||'', rec.area||'', rec.machine||'', rec.inspector||'',
               cl.itemLabel||'', cl.engineer||'', closedDate, closedTime, cl.actionTaken||'', cl.photo||'']);
  });

  rows.sort(function(a,b){ return String(b[1]).localeCompare(String(a[1])); });
  rows.forEach(function(row, i){ row[0] = i + 1; });

  if (rows.length) {
    var dataWithoutPhoto = rows.map(function(r){ return r.slice(0, ncols-1).concat(['']); });
    sh.getRange(3, 1, rows.length, ncols).setValues(dataWithoutPhoto)
      .setFontSize(9).setBackground('#E2EFDA')
      .setBorder(true,true,true,true,true,true,'#D0D7DE', SpreadsheetApp.BorderStyle.SOLID)
      .setVerticalAlignment('middle');
    rows.forEach(function(row, i) {
      sh.setRowHeight(i+3, 90);
      var photoUrl = row[ncols-1];
      if (photoUrl) {
        var imgUrl = driveUrlToImageUrl(photoUrl);
        try {
          var cellImage = SpreadsheetApp.newCellImage().setSourceUrl(imgUrl).setAltTextDescription('Evidence').build();
          sh.getRange(i+3, ncols).setValue(cellImage);
        } catch(e) {
          sh.getRange(i+3, ncols).setValue(imgUrl).setFontColor('#1155CC').setFontStyle('italic');
        }
      }
    });
    var sr = rows.length + 4;
    sh.getRange(sr,1,1,4).setValues([['Total Closures', rows.length, '', '']]);
    sh.getRange(sr,1).setFontWeight('bold').setBackground('#D9E1F2');
    sh.getRange(sr,2).setHorizontalAlignment('center').setFontWeight('bold');
  } else {
    sh.getRange(3,1).setValue('No engineering closures recorded.').setFontColor('#888888').setFontStyle('italic');
  }
  [40,110,65,100,130,100,220,100,100,80,260,150].forEach(function(w,i){sh.setColumnWidth(i+1,w);});
  sh.setFrozenRows(2);
  return sh;
}

// ============================================================
// HELPERS: findings / closure counting
// ============================================================
function countFindings(recs, closures) {
  var total = 0, closed = 0;
  recs.forEach(function(rec) {
    var rf = getRecordFindings(rec, closures);
    total  += rf.length;
    closed += rf.filter(function(f){ return f.isClosed; }).length;
  });
  return { total: total, closed: closed };
}

function getRecordFindings(rec, closures) {
  var remarkKeys = Object.keys(rec.remarks || {}).filter(function(k){ return rec.remarks[k] !== undefined; });
  var photoKeys  = Object.keys(rec.photos  || {}).filter(function(k){ return rec.photos[k] && rec.photos[k].length; });
  var allLabels  = remarkKeys.concat(photoKeys.filter(function(k){ return remarkKeys.indexOf(k) < 0; }));

  var recId       = rec.id;
  var recClosures = {};
  Object.entries(closures).forEach(function(e){
    if (String(e[0]).indexOf(recId + '_') === 0) recClosures[e[0]] = e[1];
  });

  Object.values(recClosures).forEach(function(cl) {
    var lbl = cl.itemLabel || '';
    if (lbl && allLabels.indexOf(lbl) < 0) allLabels.push(lbl);
  });

  return allLabels.map(function(label) {
    var found = null;
    Object.values(recClosures).forEach(function(cl){
      if ((cl.itemLabel || '') === label && !found) found = cl;
    });
    return { itemLabel: label, isClosed: !!found, closure: found || null };
  });
}

// ============================================================
// DEBUG / UTILITY
// ============================================================
function fixPhotoEmbeds() {
  var month = getCurrentMonth();
  var rootFolder  = getCachedFolder(DRIVE_FOLDER_ID);
  var monthFolder = getOrCreateFolder(rootFolder, month);
  var sf = getSheetFileIfExists(monthFolder, 'Inspections_' + month);
  if (!sf) { Logger.log('No Inspections sheet for ' + month); return; }
  var ss    = SpreadsheetApp.open(sf);
  var sheet = ss.getSheetByName('Records') || ss.getSheets()[0];
  var lastRow = sheet.getLastRow();
  if (lastRow < 3) { Logger.log('No data rows'); return; }
  var PHOTO_COLS = [22, 23, 24, 25];
  var fixed = 0, skipped = 0;
  for (var row = 3; row <= lastRow; row++) {
    var rowHeight = false;
    for (var ci = 0; ci < PHOTO_COLS.length; ci++) {
      var col  = PHOTO_COLS[ci];
      var cell = sheet.getRange(row, col);
      var val  = cell.getValue();
      if (!val || typeof val !== 'string' || !val.toString().startsWith('http')) { skipped++; continue; }
      var imgUrl = driveUrlToImageUrl(val.toString());
      try {
        var img = SpreadsheetApp.newCellImage().setSourceUrl(imgUrl).setAltTextDescription('Photo ' + (ci+1)).build();
        cell.setValue(img);
        cell.setNote(val.toString());
        rowHeight = true; fixed++;
      } catch(e) { Logger.log('Row ' + row + ' col ' + col + ' failed: ' + e.message); skipped++; }
    }
    if (rowHeight) sheet.setRowHeight(row, 160);
  }
  for (var pc = 0; pc < PHOTO_COLS.length; pc++) sheet.setColumnWidth(PHOTO_COLS[pc], 200);
  Logger.log('fixPhotoEmbeds done — fixed: ' + fixed + ', skipped: ' + skipped);
}

function testEngClosures() {
  var month = getCurrentMonth();
  var result = getEngClosures(month);
  var keys = Object.keys(result.closures || {});
  Logger.log('Month: ' + month);
  Logger.log('Total closure keys: ' + keys.length);
  keys.forEach(function(k) {
    var cl = result.closures[k];
    Logger.log('  Key=' + k + ' | engineer=' + (cl.engineer||'EMPTY') + ' | item=' + (cl.itemLabel||'') + ' | action=' + (cl.actionTaken||'').slice(0,30));
  });
  if (keys.length === 0) {
    Logger.log('NO CLOSURES FOUND. Check: does EngClosures_' + month + ' file exist in Drive folder?');
    var rootFolder = getCachedFolder(DRIVE_FOLDER_ID);
    var mf = getFolderIfExists(rootFolder, month);
    Logger.log('Month folder exists: ' + (mf ? 'YES' : 'NO'));
    if (mf) {
      var sf = getSheetFileIfExists(mf, 'EngClosures_' + month);
      Logger.log('EngClosures file exists: ' + (sf ? 'YES — ' + sf.getName() : 'NO'));
    }
  }
}

function debugSheet(month) {
  if (!month) month = getCurrentMonth();
  try {
    const rootFolder  = getCachedFolder(DRIVE_FOLDER_ID);
    const monthFolder = getFolderIfExists(rootFolder, month);
    if (!monthFolder) return { error: 'No month folder: ' + month };
    const sheetFile = getSheetFileIfExists(monthFolder, 'Inspections_' + month);
    if (!sheetFile) return { error: 'No sheet file for ' + month };
    const ss    = SpreadsheetApp.open(sheetFile);
    const sheet = ss.getSheetByName('Records');
    if (!sheet) return { error: 'No Records sheet' };
    const lastCol = sheet.getLastColumn(), lastRow = sheet.getLastRow();
    const row2 = sheet.getRange(2,1,1,lastCol).getValues()[0];
    const row3 = lastRow>2?sheet.getRange(3,1,1,lastCol).getValues()[0]:[];
    const row3raw = lastRow>2?sheet.getRange(3,1,1,lastCol).getDisplayValues()[0]:[];
    var allData = lastRow>2?sheet.getRange(3,1,lastRow-2,lastCol).getValues():[];
    var nonEmpty = allData.filter(function(r){return r[1]!==''&&r[1]!==null;});
    return {
      totalCols:lastCol, totalRows:lastRow, nonEmptyRows:nonEmpty.length,
      headers:row2.map(function(h,i){return '['+i+']='+String(h).replace(/\n/g,'|');}),
      firstData:row3.map(function(v,i){return '['+i+']='+String(v).slice(0,30);}),
      firstDisp:row3raw.map(function(v,i){return '['+i+']='+String(v).slice(0,30);}),
      lastData:allData.length>1?allData[allData.length-1].map(function(v,i){return '['+i+']='+String(v).slice(0,30);}):[]
    };
  } catch(e){return{error:e.message,stack:e.stack};}
}

// ============================================================
// MIGRATE
// ============================================================
function migrateSheetAddTime(sheet) {
  var headerC = String(sheet.getRange(2,3,1,1).getValue()).trim();
  if (headerC === 'Time') return;
  sheet.insertColumnBefore(3);
  sheet.getRange(2,3).setValue('Time').setBackground('#2E75B6').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(9).setHorizontalAlignment('center').setVerticalAlignment('middle');
  sheet.setColumnWidth(3,60);
  var lastRow = sheet.getLastRow();
  if (lastRow>2) sheet.getRange(3,3,lastRow-2,1).setValue('');
}

function migrateAddEngColumns(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol >= TOTAL_COLS) return;
  for (var c = lastCol + 1; c <= TOTAL_COLS; c++) {
    var idx = c - ENG_COL_START;
    if (idx >= 0 && idx < ENG_COL_HEADERS.length) {
      sheet.getRange(2, c).setValue(ENG_COL_HEADERS[idx])
        .setBackground('#C55A11').setFontColor('#FFFFFF').setFontWeight('bold')
        .setFontSize(9).setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
      sheet.setColumnWidth(c, [80,120,160,220,160][idx] || 120);
    }
  }
  for (var pc = 22; pc <= 25; pc++) sheet.setColumnWidth(pc, 130);
  try { sheet.getRange(1,1,1,1).breakApart(); sheet.getRange(1,1,1,TOTAL_COLS).merge(); } catch(e) {}
}

function updateInspRowClosure(monthFolder, month, recId, allRecClosures) {
  var sheetFile = getSheetFileIfExists(monthFolder, 'Inspections_' + month);
  if (!sheetFile) { Logger.log('updateInspRowClosure: no file for '+month); return; }
  var ssKey = 'ss_' + month;
  if (!_ssCache[ssKey]) _ssCache[ssKey] = SpreadsheetApp.open(sheetFile);
  var sheet = _ssCache[ssKey].getSheetByName('Records');
  if (!sheet) { Logger.log('updateInspRowClosure: no Records sheet'); return; }
  migrateAddEngColumns(sheet);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow <= 2) return;
  var headerRow = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
  var tsColIdx = -1;
  headerRow.forEach(function(h, i) { if (String(h).trim() === 'Submitted At') tsColIdx = i; });
  if (tsColIdx < 0) tsColIdx = 26;
  var tsCol1 = tsColIdx + 1;
  var engStartCol = -1;
  headerRow.forEach(function(h, i) {
    if (String(h).replace(/\n/g,' ').trim() === 'Eng Closure' && engStartCol < 0) engStartCol = i + 1;
  });
  if (engStartCol < 0) engStartCol = ENG_COL_START;
  var tsVals = sheet.getRange(3, tsCol1, lastRow - 2, 1).getValues();
  for (var i = 0; i < tsVals.length; i++) {
    var raw = tsVals[i][0];
    if (!raw) continue;
    var rowId;
    if (raw instanceof Date) { rowId = String(raw.getTime()); }
    else { var d = new Date(raw); rowId = isNaN(d.getTime()) ? String(raw) : String(d.getTime()); }
    if (rowId !== String(recId)) continue;
    var rowNum = i + 3;
    var closedByList = [], dateList = [], actionList = [], photoList = [];
    var total = 0, closed = 0;
    Object.entries(allRecClosures).forEach(function(e) {
      var cl = e[1]; total++;
      var label = cl.itemLabel || '?';
      if (cl.engineer) {
        closed++;
        closedByList.push(label + ' → ' + cl.engineer);
        dateList.push(cl.closedAt ? cl.closedAt.slice(0,16).replace('T',' ') : '');
        actionList.push(label + ': ' + (cl.actionTaken || ''));
        if (cl.photo) photoList.push(cl.photo);
      }
    });
    var closureStatus = total > 0 ? (closed + '/' + total + ' closed') : '—';
    sheet.getRange(rowNum, engStartCol, 1, ENG_COL_HEADERS.length).setValues([[
      closureStatus, closedByList.join('\n')||'', dateList.join('\n')||'', actionList.join('\n')||'', ''
    ]]).setWrap(true).setVerticalAlignment('middle').setFontSize(8);
    var photoCol = engStartCol + 4;
    if (photoList.length > 0) {
      var imgUrl = driveUrlToImageUrl(photoList[0]);
      try {
        var cellImage = SpreadsheetApp.newCellImage().setSourceUrl(imgUrl).setAltTextDescription('Closure photo').build();
        sheet.getRange(rowNum, photoCol).setValue(cellImage);
      } catch(imgErr) { sheet.getRange(rowNum, photoCol).setValue(imgUrl); }
      if (photoList.length > 1) {
        sheet.getRange(rowNum, photoCol).setNote(photoList.slice(1).map(function(u,i){ return 'Photo '+(i+2)+': '+u; }).join('\n'));
      }
    } else { sheet.getRange(rowNum, photoCol).clearContent().clearNote(); }
    var statusCell = sheet.getRange(rowNum, engStartCol);
    if (total === 0)         { statusCell.setBackground('#F5F5F5').setFontColor('#888888').setFontWeight('normal'); }
    else if (closed===total) { statusCell.setBackground('#E2EFDA').setFontColor('#1a5c2a').setFontWeight('bold'); }
    else if (closed > 0)     { statusCell.setBackground('#FFEB9C').setFontColor('#7d4e00').setFontWeight('bold'); }
    else                     { statusCell.setBackground('#FCE4D6').setFontColor('#9b1c1c').setFontWeight('bold'); }
    sheet.getRange(rowNum, engStartCol+1, 1, ENG_COL_HEADERS.length-1).setBackground('#FFFDE7');
    sheet.setRowHeight(rowNum, Math.max(120, 22 * Math.max(1, closedByList.length)));
    sheet.setColumnWidth(engStartCol + 4, 160);
    Logger.log('updateInspRowClosure OK: row='+rowNum+' recId='+recId+' status='+closureStatus);
    break;
  }
}

// ============================================================
// SUBMIT
// ============================================================
function submitRecord(rec) {
  const month       = rec.date.slice(0,7);
  const rootFolder  = getCachedFolder(DRIVE_FOLDER_ID);
  const monthFolder = getOrCreateFolder(rootFolder, month);
  const sheet       = getOrCreateMonthSheet(monthFolder, month);
  migrateSheetAddTime(sheet);
  const rowNum   = sheet.getLastRow()+1;
  const submitTs = new Date().toISOString();
  const s        = rec.senseScores||{};
  const rowData  = [
    rowNum-2, rec.date, rec.time||'', rec.area||'', rec.machine||'', rec.supervisor||'', rec.shift||'', rec.inspector||'',
    s.sight?.ok||0, s.sight?.nok||0, s.hear?.ok||0, s.hear?.nok||0, s.smell?.ok||0, s.smell?.nok||0, s.touch?.ok||0, s.touch?.nok||0,
    rec.totalOK||0, rec.totalNOK||0, rec.totalNA||0, rec.pass?'PASS':'FAIL',
    buildRemarksText(rec.remarks||{}), '','','','', rec.notes||'', submitTs
  ];
  sheet.getRange(rowNum,1,1,NUM_COLS).setValues([rowData]);
  styleDataRow(sheet,rowNum,rec.pass,true);

  const allPhotoUrls=[];
  if (rec.photos && Object.keys(rec.photos).length>0) {
    const photosBase = getOrCreateFolder(monthFolder,'Photos');
    const dayFolder  = getOrCreateFolder(photosBase,rec.date);
    const uploads=[];
    Object.entries(rec.photos).forEach(([label,b64Array])=>{
      b64Array.forEach((b64,i)=>{
        try {
          const mimeType=b64.split(';')[0].split(':')[1];
          const base64Data=b64.split(',')[1];
          const safeName=label.replace(/[^a-zA-Z0-9]/g,'_').substring(0,35);
          uploads.push({blob:Utilities.newBlob(Utilities.base64Decode(base64Data),mimeType,rec.machine+'_'+safeName+'_'+(i+1)+'.jpg')});
        } catch(e){}
      });
    });
    uploads.forEach(function(u){
      try {
        const file=dayFolder.createFile(u.blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK,DriveApp.Permission.VIEW);
        allPhotoUrls.push(file.getUrl());
      } catch(e){}
    });
    if (allPhotoUrls.length>0) {
      for (var pi = 0; pi < Math.min(allPhotoUrls.length, 4); pi++) {
        var pUrl = allPhotoUrls[pi];
        if (!pUrl) continue;
        var pImgUrl = driveUrlToImageUrl(pUrl);
        var photoRange = sheet.getRange(rowNum, 22+pi);
        try {
          var pCell = SpreadsheetApp.newCellImage().setSourceUrl(pImgUrl).setAltTextDescription('Photo '+(pi+1)).build();
          photoRange.setValue(pCell);
        } catch(e) {
          try { photoRange.setFormula('=IMAGE("' + pImgUrl + '",4,90,120)'); }
          catch(e2) { photoRange.setValue(pUrl); }
        }
        try { photoRange.setNote(pUrl); } catch(e) {}
      }
      sheet.setRowHeight(rowNum, 160);
    }
  }
  const closuresForSummary = getEngClosures(month).closures || {};
  try{regenerateSummarySheet(monthFolder,month,null,closuresForSummary);}catch(e){}
  delete rec.photos; rec.photoUrls=allPhotoUrls; rec.photoCount=allPhotoUrls.length;
  return{success:true,record:rec,rowNumber:rowNum};
}

// ============================================================
// GET RECORDS
// ============================================================
function getRecords(month) {
  if (!month) month = getCurrentMonth();
  const rootFolder  = getCachedFolder(DRIVE_FOLDER_ID);
  const monthFolder = getFolderIfExists(rootFolder,month);
  if (!monthFolder) return{records:[],month:month};
  const sheetFile = getSheetFileIfExists(monthFolder,'Inspections_'+month);
  if (!sheetFile) return{records:[],month:month};
  const ssKey='ss_'+month;
  if (!_ssCache[ssKey]) _ssCache[ssKey]=SpreadsheetApp.open(sheetFile);
  const sheet=_ssCache[ssKey].getSheetByName('Records');
  if (!sheet) return{records:[],month:month};
  const lastRow=sheet.getLastRow();
  if (lastRow<=2) return{records:[],month:month};
  const lastCol=sheet.getLastColumn();
  const headerRow=sheet.getRange(2,1,1,lastCol).getValues()[0];
  const col={};
  headerRow.forEach(function(h,i){if(h!==''){var s=String(h).trim();col[s]=i;col[s.replace(/[\n|]/g,' ')]=i;col[s.replace(/[\n|]/g,'\n')]=i;}});
  function ci(name){var c=col[name];return(c!==undefined)?c:-1;}
  const I={
    date:ci('Date'),time:ci('Time'),area:ci('Area'),machine:ci('Machine'),supervisor:ci('Area Owner'),
    shift:ci('Shift'),inspector:ci('Inspector'),sightOK:ci('Sight OK'),sightNOK:ci('Sight NOT OK'),
    hearOK:ci('Hearing OK'),hearNOK:ci('Hearing NOT OK'),smellOK:ci('Smell OK'),smellNOK:ci('Smell NOT OK'),
    touchOK:ci('Touch OK'),touchNOK:ci('Touch NOT OK'),totalOK:ci('Total OK'),totalNOK:ci('Total NOT OK'),
    totalNA:ci('Total N/A'),result:ci('Result'),remarks:ci('Remarks / Issues'),
    photo1:ci('Photo 1'),photo2:ci('Photo 2'),photo3:ci('Photo 3'),photo4:ci('Photo 4'),
    notes:ci('Notes'),ts:ci('Submitted At')
  };
  const data=sheet.getRange(3,1,lastRow-2,lastCol).getValues();
  var photoColIndices=[I.photo1,I.photo2,I.photo3,I.photo4].filter(function(pi){return pi>=0;});
  var allNotes={};
  if(photoColIndices.length){
    photoColIndices.forEach(function(pi){
      var notesData=sheet.getRange(3,pi+1,lastRow-2,1).getNotes();
      notesData.forEach(function(nr,ri){
        var note=nr[0]||'';
        if(note.startsWith('http')){if(!allNotes[ri])allNotes[ri]={};allNotes[ri][pi]=note;}
      });
    });
  }
  var records=data.map(function(row,rowIdx){
    if(!row[I.date]&&row[I.date]!==0)return null;
    var rawDate=row[I.date];
    var dateStr=rawDate instanceof Date?Utilities.formatDate(rawDate,Session.getScriptTimeZone(),'yyyy-MM-dd'):String(rawDate);
    var timeVal='';
    if(I.time>=0){var tv=row[I.time];if(tv instanceof Date&&!isNaN(tv.getTime())){timeVal=('0'+tv.getHours()).slice(-2)+':'+('0'+tv.getMinutes()).slice(-2);}else if(tv){var ts=String(tv).trim();if(ts.match(/^\d{1,2}:\d{2}/))timeVal=ts.slice(0,5);}}
    var photos=[];
    [I.photo1,I.photo2,I.photo3,I.photo4].forEach(function(pi){if(pi<0)return;var v=String(row[pi]||'').trim();if(v.startsWith('http'))photos.push(v);});
    if(photos.length===0&&allNotes[rowIdx]){Object.values(allNotes[rowIdx]).forEach(function(note){if(note&&note.startsWith('http'))photos.push(note);});}
    return{
      id:String(row[I.ts]?new Date(row[I.ts]).getTime():Math.random()),
      date:dateStr,time:timeVal,area:String(row[I.area]||''),machine:String(row[I.machine]||''),
      supervisor:String(row[I.supervisor]||''),shift:String(row[I.shift]||''),inspector:String(row[I.inspector]||''),
      totalOK:Number(row[I.totalOK])||0,totalNOK:Number(row[I.totalNOK])||0,totalNA:Number(row[I.totalNA])||0,
      pass:String(row[I.result]).toUpperCase()==='PASS',notes:String(row[I.notes]||''),
      photoUrls:photos,photoCount:photos.length,remarks:parseRemarks(String(row[I.remarks]||'')),
      senseScores:{
        sight:{ok:Number(row[I.sightOK])||0,nok:Number(row[I.sightNOK])||0},
        hear:{ok:Number(row[I.hearOK])||0,nok:Number(row[I.hearNOK])||0},
        smell:{ok:Number(row[I.smellOK])||0,nok:Number(row[I.smellNOK])||0},
        touch:{ok:Number(row[I.touchOK])||0,nok:Number(row[I.touchNOK])||0}
      }
    };
  }).filter(Boolean);
  return{records:records,month:month};
}

// ============================================================
// DELETE RECORD
// ============================================================
function deleteRecord(id,month) {
  if(!month)month=getCurrentMonth();
  const rootFolder=getCachedFolder(DRIVE_FOLDER_ID);
  const monthFolder=getFolderIfExists(rootFolder,month);
  if(!monthFolder)return{success:false,error:'Month folder not found'};
  const sheetFile=getSheetFileIfExists(monthFolder,'Inspections_'+month);
  if(!sheetFile)return{success:false};
  const ss=SpreadsheetApp.open(sheetFile);
  const sheet=ss.getSheetByName('Records');
  if(!sheet)return{success:false};
  const lastRow=sheet.getLastRow();
  if(lastRow<=2)return{success:false};
  const lastCol=sheet.getLastColumn();
  const headerRow=sheet.getRange(2,1,1,lastCol).getValues()[0];
  var tsColIdx=-1;
  headerRow.forEach(function(h,i){if(String(h).trim()==='Submitted At')tsColIdx=i;});
  if(tsColIdx<0)tsColIdx=25;
  const tsCol=sheet.getRange(3,tsColIdx+1,lastRow-2,1).getValues();
  for(var i=0;i<tsCol.length;i++){
    var rowId=tsCol[i][0]?String(new Date(tsCol[i][0]).getTime()):'';
    if(rowId===String(id)){sheet.deleteRow(i+3);try{regenerateSummarySheet(monthFolder,month);}catch(e){}return{success:true};}
  }
  return{success:false,error:'Row not found'};
}

// ============================================================
// SHEET SETUP
// ============================================================
function getOrCreateMonthSheet(monthFolder,month) {
  const fileName='Inspections_'+month,ssKey='ss_'+month;
  var sheetFile=getSheetFileIfExists(monthFolder,fileName),ss;
  if(!sheetFile){
    ss=SpreadsheetApp.create(fileName);
    const file=DriveApp.getFileById(ss.getId());
    monthFolder.addFile(file);DriveApp.getRootFolder().removeFile(file);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK,DriveApp.Permission.VIEW);
    _ssCache[ssKey]=ss;
  } else {
    if(!_ssCache[ssKey])_ssCache[ssKey]=SpreadsheetApp.open(sheetFile);
    ss=_ssCache[ssKey];
  }
  var sheet=ss.getSheetByName('Records');
  if(!sheet){sheet=ss.getActiveSheet();sheet.setName('Records');setupSheetHeaders(sheet,month);}
  return sheet;
}

function setupSheetHeaders(sheet,month) {
  sheet.getRange(1,1,1,TOTAL_COLS).merge().setValue('STARKEN — 4-SENSES DAILY INSPECTION LOG   |   '+month)
    .setBackground('#1F3864').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(13).setHorizontalAlignment('center').setVerticalAlignment('middle');
  sheet.setRowHeight(1,36);
  var allHeaders = HEADERS.concat(ENG_COL_HEADERS);
  sheet.getRange(2,1,1,TOTAL_COLS).setValues([allHeaders]).setBackground('#2E75B6').setFontColor('#FFFFFF')
    .setFontWeight('bold').setFontSize(9).setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  sheet.getRange(2,ENG_COL_START,1,ENG_COL_HEADERS.length).setBackground('#C55A11');
  sheet.setRowHeight(2,40);
  var widths=[40,80,60,90,100,90,110,90,50,50,50,50,50,50,50,50,55,55,55,65,200,200,200,200,200,160,140,80,120,160,220,160];
  widths.forEach(function(w,i){sheet.setColumnWidth(i+1,w);});
  sheet.setFrozenRows(2);
}

function styleDataRow(sheet,rowNum,pass,hasTime) {
  var totalCols=hasTime?NUM_COLS:NUM_COLS-1,resultCol=hasTime?20:19,remarksCol=hasTime?21:20,scoreStart=hasTime?9:8;
  sheet.getRange(rowNum,1,1,totalCols).setBackground(pass?'#E2EFDA':'#FCE4D6').setVerticalAlignment('middle').setFontSize(9)
    .setBorder(true,true,true,true,true,true,'#D0D7DE',SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange(rowNum,resultCol).setFontWeight('bold').setFontColor(pass?'#1a5c2a':'#9b1c1c').setHorizontalAlignment('center');
  sheet.getRange(rowNum,scoreStart,1,11).setHorizontalAlignment('center');
  sheet.getRange(rowNum,remarksCol).setWrap(true);
  sheet.getRange(rowNum,2).setNumberFormat('yyyy-mm-dd');
  sheet.setRowHeight(rowNum,22);
}

// ============================================================
// SUMMARY SHEET (Monthly_Report)
// ============================================================
function regenerateSummarySheet(monthFolder, month, recsArg, closuresArg) {
  const recs     = recsArg || getRecords(month).records;
  const closures = closuresArg !== undefined ? closuresArg : (getEngClosures(month).closures || {});
  const fname = 'Monthly_Report_' + month;
  var sf=getSheetFileIfExists(monthFolder,fname),ss;
  if(!sf){
    ss=SpreadsheetApp.create(fname);
    const f=DriveApp.getFileById(ss.getId());
    monthFolder.addFile(f);DriveApp.getRootFolder().removeFile(f);
    f.setSharing(DriveApp.Access.ANYONE_WITH_LINK,DriveApp.Permission.VIEW);
  } else { ss=SpreadsheetApp.open(sf); }
  var sheet=ss.getSheetByName('Summary');
  if(!sheet){sheet=ss.getActiveSheet();sheet.setName('Summary');}
  sheet.clearContents();sheet.clearFormats();
  var oldEngTab = ss.getSheetByName('Eng Closures');
  if (oldEngTab && ss.getSheets().length > 1) { try { ss.deleteSheet(oldEngTab); } catch(e) {} }
  if(!recs.length){sheet.getRange(1,1).setValue('No records yet for '+month);return ss;}

  const total=recs.length,passed=recs.filter(function(r){return r.pass;}).length;
  const totalOK=recs.reduce(function(a,r){return a+(r.totalOK||0);},0);
  const totalNOK=recs.reduce(function(a,r){return a+(r.totalNOK||0);},0);
  const passRate=(totalOK+totalNOK)?Math.round(totalOK/(totalOK+totalNOK)*100):0;
  const findings=countFindings(recs, closures);
  const clPct = findings.total ? Math.round(findings.closed / findings.total * 100) : 100;
  const senses=['sight','hear','smell','touch'],sLabels=['Sight','Hearing','Smell','Touch'];
  var r=1;

  sheet.getRange(r,1,1,6).merge()
    .setValue('STARKEN 4-SENSES — MONTHLY SUMMARY   |   '+month+'   |   Updated: '+Utilities.formatDate(new Date(),Session.getScriptTimeZone(),'yyyy-MM-dd HH:mm')+'   |   Closures: '+Object.keys(closures).length)
    .setBackground('#1F3864').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(13).setHorizontalAlignment('center');
  sheet.setRowHeight(r,36);r+=2;
  sheet.getRange(r,1,1,4).merge().setValue('OVERALL KPIs').setBackground('#2E75B6').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(10);r++;
  [['Total Inspections',total,'Pass Rate',passRate+'%'],['Passed ✅',passed,'Failed ❌',total-passed],['Total Items OK',totalOK,'Total NOT OK',totalNOK]].forEach(function(row){
    sheet.getRange(r,1,1,4).setValues([row]);
    sheet.getRange(r,1).setFontWeight('bold').setBackground('#D9E1F2');
    sheet.getRange(r,3).setFontWeight('bold').setBackground('#D9E1F2');
    sheet.getRange(r,2).setHorizontalAlignment('center');
    sheet.getRange(r,4).setHorizontalAlignment('center').setFontWeight('bold');r++;
  });r++;

  var clColor=clPct===100?'#1a5c2a':clPct>=50?'#7d4e00':'#9b1c1c';
  var clBg=clPct===100?'#E2EFDA':clPct>=50?'#FFEB9C':'#FCE4D6';
  sheet.getRange(r,1,1,4).merge().setValue('🔧 ENGINEERING CLOSURE RATE').setBackground('#843C0C').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(10);r++;
  sheet.getRange(r,1,1,4).setValues([['NOK Findings Found',findings.total,'Issues Closed',findings.closed+' / '+findings.total]]).setBackground(clBg);
  sheet.getRange(r,1).setFontWeight('bold').setBackground('#F9CB9C');sheet.getRange(r,3).setFontWeight('bold').setBackground('#F9CB9C');
  sheet.getRange(r,2).setHorizontalAlignment('center');sheet.getRange(r,4).setHorizontalAlignment('center').setFontWeight('bold').setFontColor(clColor);r++;
  sheet.getRange(r,1,1,2).merge().setValue('Overall Closure Rate');sheet.getRange(r,1).setFontWeight('bold').setBackground('#F9CB9C');
  sheet.getRange(r,3,1,2).merge().setValue(clPct+'%').setBackground(clBg).setFontColor(clColor).setFontWeight('bold').setFontSize(16).setHorizontalAlignment('center');
  sheet.setRowHeight(r,32);r++;r++;

  sheet.getRange(r,1,1,5).merge().setValue('Closure Detail by Machine').setBackground('#C55A11').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(9);r++;
  sheet.getRange(r,1,1,5).setValues([['Area','Machine','NOK Found','Closed','Closure %']]).setBackground('#F4B183').setFontWeight('bold').setHorizontalAlignment('center');r++;
  var machClosureMap={};
  recs.forEach(function(rec){
    var k=(rec.area||'?')+'||'+(rec.machine||'?');
    if(!machClosureMap[k])machClosureMap[k]={area:rec.area||'',machine:rec.machine||'',findings:0,closed:0};
    var rf=getRecordFindings(rec,closures);
    machClosureMap[k].findings+=rf.length;
    machClosureMap[k].closed+=rf.filter(function(f){return f.isClosed;}).length;
  });
  var machClosureRows=Object.values(machClosureMap).filter(function(m){return m.findings>0;}).sort(function(a,b){return b.findings-a.findings;});
  if(machClosureRows.length===0){
    sheet.getRange(r,1,1,5).merge().setValue('No NOK findings this month').setFontStyle('italic').setFontColor('#888888').setHorizontalAlignment('center');r++;
  } else {
    machClosureRows.forEach(function(m){
      var mcp=m.findings?Math.round(m.closed/m.findings*100):100;
      var mbg=mcp===100?'#E2EFDA':mcp>=50?'#FFEB9C':'#FCE4D6';
      var mfc=mcp===100?'#1a5c2a':mcp>=50?'#7d4e00':'#9b1c1c';
      sheet.getRange(r,1,1,5).setValues([[m.area,m.machine,m.findings,m.closed,mcp+'%']]).setBackground(mbg);
      sheet.getRange(r,3,1,3).setHorizontalAlignment('center');sheet.getRange(r,5).setFontColor(mfc).setFontWeight('bold');r++;
    });
  }
  r++;

  sheet.getRange(r,1,1,4).merge().setValue('OK RATE BY SENSE').setBackground('#2E75B6').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(10);r++;
  sheet.getRange(r,1,1,4).setValues([['Sense','Items OK','Items NOT OK','OK Rate']]).setBackground('#BDD7EE').setFontWeight('bold').setHorizontalAlignment('center');r++;
  senses.forEach(function(s,i){
    var ok=recs.reduce(function(a,rec){return a+(rec.senseScores&&rec.senseScores[s]?rec.senseScores[s].ok:0);},0);
    var nok=recs.reduce(function(a,rec){return a+(rec.senseScores&&rec.senseScores[s]?rec.senseScores[s].nok:0);},0);
    var rt=(ok+nok)?Math.round(ok/(ok+nok)*100):100;
    sheet.getRange(r,1,1,4).setValues([[sLabels[i],ok,nok,rt+'%']]);
    sheet.getRange(r,4).setFontColor(rt>=90?'#1a5c2a':rt>=70?'#7d4e00':'#9b1c1c').setFontWeight('bold');
    sheet.getRange(r,2,1,3).setHorizontalAlignment('center');r++;
  });r++;

  sheet.getRange(r,1,1,5).merge().setValue('MACHINE BREAKDOWN').setBackground('#2E75B6').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(10);r++;
  sheet.getRange(r,1,1,5).setValues([['Area','Machine','Inspections','Pass','NOT OK Issues']]).setBackground('#BDD7EE').setFontWeight('bold').setHorizontalAlignment('center');r++;
  var machMap={};
  recs.forEach(function(rec){var k=rec.area+'||'+rec.machine;if(!machMap[k])machMap[k]={area:rec.area,machine:rec.machine,total:0,pass:0,nok:0};machMap[k].total++;if(rec.pass)machMap[k].pass++;machMap[k].nok+=(rec.totalNOK||0);});
  Object.values(machMap).forEach(function(m){sheet.getRange(r,1,1,5).setValues([[m.area,m.machine,m.total,m.pass,m.nok]]);sheet.getRange(r,3,1,3).setHorizontalAlignment('center');if(m.nok>0)sheet.getRange(r,5).setFontColor('#9b1c1c').setFontWeight('bold');r++;});r++;

  sheet.getRange(r,1,1,4).merge().setValue('INSPECTOR BREAKDOWN').setBackground('#2E75B6').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(10);r++;
  sheet.getRange(r,1,1,4).setValues([['Inspector','Inspections','Pass','Pass Rate']]).setBackground('#BDD7EE').setFontWeight('bold').setHorizontalAlignment('center');r++;
  var inspMap2={};
  recs.forEach(function(rec){if(!inspMap2[rec.inspector])inspMap2[rec.inspector]={total:0,pass:0};inspMap2[rec.inspector].total++;if(rec.pass)inspMap2[rec.inspector].pass++;});
  Object.entries(inspMap2).forEach(function(entry){var name=entry[0],d=entry[1],rt=d.total?Math.round(d.pass/d.total*100):0;sheet.getRange(r,1,1,4).setValues([[name,d.total,d.pass,rt+'%']]);sheet.getRange(r,2,1,3).setHorizontalAlignment('center');sheet.getRange(r,4).setFontColor(rt>=90?'#1a5c2a':'#9b1c1c').setFontWeight('bold');r++;});r++;

  sheet.getRange(r,1,1,5).merge().setValue('🔧 ENG CLOSURE BY PERSON').setBackground('#843C0C').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(10);r++;
  sheet.getRange(r,1,1,5).setValues([['Closed By','Issues Closed','% of All Closures','Avg Response Time','Fastest / Slowest']]).setBackground('#F4B183').setFontWeight('bold').setFontSize(9).setHorizontalAlignment('center').setWrap(true);
  sheet.setRowHeight(r,32);r++;
  var engStats={},totalEngClosed=0,recById2={};
  recs.forEach(function(rec){recById2[rec.id]=rec;});
  Object.entries(closures).forEach(function(entry){
    var issueKey=entry[0],cl=entry[1];
    if(!cl.engineer)return;
    var eng=cl.engineer;
    if(!engStats[eng])engStats[eng]={count:0,responseTimes:[]};
    engStats[eng].count++;totalEngClosed++;
    var recId=String(issueKey).split('_')[0],rec=recById2[recId];
    var submittedAt=rec&& rec.id?new Date(parseInt(rec.id)):null;
    var closedAt=cl.closedAt?new Date(cl.closedAt):null;
    if(submittedAt&&closedAt&&!isNaN(submittedAt.getTime())&&!isNaN(closedAt.getTime())){
      var hrs=(closedAt.getTime()-submittedAt.getTime())/3600000;
      if(hrs>=0)engStats[eng].responseTimes.push(hrs);
    }
  });
  var engRows=Object.entries(engStats).sort(function(a,b){return b[1].count-a[1].count;});
  if(engRows.length===0){
    sheet.getRange(r,1,1,5).merge().setValue('No closures recorded yet').setFontStyle('italic').setFontColor('#888888').setHorizontalAlignment('center');r++;
  } else {
    engRows.forEach(function(entry){
      var eng=entry[0],st=entry[1],pct=totalEngClosed?Math.round(st.count/totalEngClosed*100):0;
      var avgHrs='',fastSlow='';
      if(st.responseTimes.length){
        var sum=st.responseTimes.reduce(function(a,b){return a+b;},0),avg=sum/st.responseTimes.length;
        var mn=Math.min.apply(null,st.responseTimes),mx=Math.max.apply(null,st.responseTimes);
        avgHrs=avg<24?avg.toFixed(1)+' hrs':(avg/24).toFixed(1)+' days';
        fastSlow=(mn<24?mn.toFixed(1)+' hrs':(mn/24).toFixed(1)+' days')+' / '+(mx<24?mx.toFixed(1)+' hrs':(mx/24).toFixed(1)+' days');
      } else {avgHrs='—';fastSlow='—';}
      sheet.getRange(r,1,1,5).setValues([[eng,st.count,pct+'%',avgHrs,fastSlow]]).setBackground(pct>=30?'#E2EFDA':pct>=10?'#FFEB9C':'#F5F5F5');
      sheet.getRange(r,2,1,4).setHorizontalAlignment('center');sheet.getRange(r,2).setFontWeight('bold');r++;
    });
    sheet.getRange(r,1,1,5).setValues([['TOTAL',totalEngClosed,'100%','','']]).setBackground('#D9E1F2').setFontWeight('bold');
    sheet.getRange(r,2,1,3).setHorizontalAlignment('center');r++;
  }
  [160,160,110,110,120].forEach(function(w,i){sheet.setColumnWidth(i+1,w);});sheet.setFrozenRows(1);
  return ss;
}

// ============================================================
// HELPERS
// ============================================================
function getCachedFolder(id){if(!_folderCache[id])_folderCache[id]=DriveApp.getFolderById(id);return _folderCache[id];}
function getOrCreateFolder(parent,name){var iter=parent.getFoldersByName(name);return iter.hasNext()?iter.next():parent.createFolder(name);}
function getFolderIfExists(parent,name){var iter=parent.getFoldersByName(name);return iter.hasNext()?iter.next():null;}
function getSheetFileIfExists(folder,name){var iter=folder.getFilesByName(name);return iter.hasNext()?iter.next():null;}
function getCurrentMonth(){return Utilities.formatDate(new Date(),Session.getScriptTimeZone(),'yyyy-MM');}

function buildRemarksText(remarks){
  return Object.entries(remarks)
    .filter(function(e){ return e[0]; })
    .map(function(e){ return '• '+e[0]+': '+(e[1]||''); })
    .join('\n');
}

function parseRemarks(text){
  var result={};
  text.split('\n').forEach(function(line){
    var m=line.match(/^[•\-]\s*(.+?):\s*(.*)$/);
    if(m)result[m[1]]=m[2];
  });
  return result;
}

function respond(data){return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);}

function driveUrlToImageUrl(url) {
  if (!url) return '';
  if (url.indexOf('lh3.googleusercontent.com') >= 0) return url;
  var match = url.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  if (!match) match = url.match(/id=([a-zA-Z0-9_-]{20,})/);
  if (match) return 'https://drive.google.com/uc?export=view&id=' + match[1];
  return url;
}

// ============================================================
// ENGINEERING CLOSURES (Optimized Functions)
// ============================================================
function syncAllClosures(month, clientClosures) {
  if (!month || !clientClosures || typeof clientClosures !== 'object') return { success: false, error: 'bad params' };
  
  const keys = Object.keys(clientClosures);
  if (keys.length === 0) return { success: true, synced: 0 };
  
  const rootFolder  = getCachedFolder(DRIVE_FOLDER_ID);
  const monthFolder = getOrCreateFolder(rootFolder, month);
  const engSheet    = getEngClosuresSheet(monthFolder, month);
  
  const lastRow = engSheet.getLastRow();
  const existingData = lastRow >= 2 ? engSheet.getRange(2, 1, lastRow - 1, 1).getValues() : [];
  const keyMap = {};
  existingData.forEach((r, i) => { keyMap[String(r[0])] = i + 2; });

  let synced = 0;
  keys.forEach(key => {
    const cl = clientClosures[key];
    if (!cl || !cl.engineer) return;

    const row = [
      key, 
      cl.itemLabel || '', 
      cl.actionTaken || '', 
      cl.photo || '', 
      cl.engineer || '', 
      cl.closedAt || '', 
      new Date().toISOString()
    ];

    if (keyMap[key]) {
      engSheet.getRange(keyMap[key], 1, 1, 7).setValues([row]);
    } else {
      engSheet.appendRow(row);
      keyMap[key] = engSheet.getLastRow();
    }
    synced++;
  });

  Logger.log('syncAllClosures: synced ' + synced + ' closures for month ' + month);
  return { success: true, synced: synced };
}

function getEngClosuresSheet(monthFolder, month) {
  var fileName='EngClosures_'+month, sheetFile=getSheetFileIfExists(monthFolder,fileName), ss;
  if(!sheetFile){
    ss=SpreadsheetApp.create(fileName);
    var f=DriveApp.getFileById(ss.getId());monthFolder.addFile(f);DriveApp.getRootFolder().removeFile(f);
    f.setSharing(DriveApp.Access.ANYONE_WITH_LINK,DriveApp.Permission.VIEW);
  } else { ss=SpreadsheetApp.open(sheetFile); }
  var sheet=ss.getSheetByName('Closures');
  if(!sheet){
    sheet=ss.getActiveSheet();sheet.setName('Closures');
    sheet.getRange(1,1,1,ENG_HEADERS.length).setValues([ENG_HEADERS]).setBackground('#1F3864').setFontColor('#FFFFFF').setFontWeight('bold');
  } else {
    var ncols=sheet.getLastColumn();
    if(ncols<7){sheet.insertColumnAfter(1);sheet.getRange(1,2).setValue('NOK Item').setBackground('#1F3864').setFontColor('#FFFFFF').setFontWeight('bold');}
  }
  return sheet;
}

function getEngClosures(month) {
  if(!month)month=Utilities.formatDate(new Date(),Session.getScriptTimeZone(),'yyyy-MM');
  var rootFolder=getCachedFolder(DRIVE_FOLDER_ID);
  var closures={};
  function readSheet(sheet){
    var lastRow=sheet.getLastRow();
    if(lastRow<2)return;
    var lastCol=sheet.getLastColumn();
    var rows=sheet.getRange(2,1,lastRow-1,lastCol).getValues();
    rows.forEach(function(row){
      var key=String(row[0]).trim();
      if(!key||key==='IssueKey')return;
      if(lastCol>=7){var ca=row[5] instanceof Date?row[5].toISOString():String(row[5]||'');closures[key]={itemLabel:String(row[1]||''),actionTaken:String(row[2]||''),photo:String(row[3]||''),engineer:String(row[4]||''),closedAt:ca};}
      else{var ca=row[4] instanceof Date?row[4].toISOString():String(row[4]||'');closures[key]={itemLabel:'',actionTaken:String(row[1]||''),photo:String(row[2]||''),engineer:String(row[3]||''),closedAt:ca};}
    });
  }
  var mf=getFolderIfExists(rootFolder,month);
  if(mf){
    var sf=getSheetFileIfExists(mf,'EngClosures_'+month);
    if(sf){
      try{var ss=SpreadsheetApp.open(sf);var sh=ss.getSheetByName('Closures')||ss.getSheets()[0];if(sh)readSheet(sh);Logger.log('getEngClosures primary: '+Object.keys(closures).length+' entries');}
      catch(e){Logger.log('getEngClosures primary err: '+e.message);}
    } else {
      Logger.log('getEngClosures: EngClosures_'+month+' not found');
      var files=mf.getFiles();
      while(files.hasNext()){var file=files.next();if(file.getName().toLowerCase().indexOf('engclosure')<0)continue;try{var ss2=SpreadsheetApp.open(file);ss2.getSheets().forEach(function(sh2){readSheet(sh2);});}catch(e2){}}
    }
  } else {Logger.log('getEngClosures: month folder "'+month+'" not found');}
  Logger.log('getEngClosures TOTAL for '+month+': '+Object.keys(closures).length);
  return{closures:closures};
}

function saveEngClosure(payload) {
  const closureMonth = (payload.closedAt || '').slice(0, 7) || getCurrentMonth();
  const inspMonth = payload.inspMonth || closureMonth;
  const rootFolder = getCachedFolder(DRIVE_FOLDER_ID);
  const mf = getOrCreateFolder(rootFolder, closureMonth);
  const sheet = getEngClosuresSheet(mf, closureMonth);
  
  let photoUrl = payload.photo || '';

  if (photoUrl.length > 200 && photoUrl.indexOf('http') === -1) {
    try {
      const photoFolder = getOrCreateFolder(mf, 'Photos');
      const b64 = photoUrl.indexOf(',') > -1 ? photoUrl.split(',')[1] : photoUrl;
      const blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', 
                   'Eng_' + String(payload.issueKey).replace(/[^a-z0-9]/gi, '_') + '.jpg');
      const file = photoFolder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      photoUrl = 'https://drive.google.com/uc?export=view&id=' + file.getId();
    } catch (e) {
      Logger.log('Photo upload failed: ' + e.message);
      photoUrl = '';
    }
  }

  const newRow = [
    payload.issueKey, 
    payload.itemLabel || '', 
    payload.actionTaken || '', 
    photoUrl, 
    payload.engineer || '', 
    payload.closedAt || new Date().toISOString(), 
    new Date().toISOString()
  ];

  const lastRow = sheet.getLastRow();
  let updated = false;
  if (lastRow > 1) {
    const keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) {
      if (String(keys[i][0]) === String(payload.issueKey)) {
        sheet.getRange(i + 2, 1, 1, 7).setValues([newRow]);
        updated = true;
        break;
      }
    }
  }
  if (!updated) sheet.appendRow(newRow);

  try {
    const recId = String(payload.issueKey).split('_')[0];
    const inspMf = getOrCreateFolder(rootFolder, inspMonth);
    const allForRecord = getEngClosures(closureMonth).closures;
    
    allForRecord[payload.issueKey] = {
      itemLabel: payload.itemLabel || '',
      actionTaken: payload.actionTaken || '',
      photo: photoUrl,
      engineer: payload.engineer || '',
      closedAt: payload.closedAt || ''
    };
    
    updateInspRowClosure(inspMf, inspMonth, recId, allForRecord);
  } catch (e) {
    Logger.log('Failed to sync back to Inspection sheet: ' + e.message + '\n' + e.stack);
  }

  return { success: true, photoUrl: photoUrl };
}

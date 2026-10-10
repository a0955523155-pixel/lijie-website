import {privateRequest,renderCompletedReport} from "../housekeeping/report-form.js";
export function installHousekeepingAdmin(token){
  const $=selector=>document.querySelector(selector);let settingsLoaded=false,lastState=null,disposers=[];
  const form=$("#housekeepingReminderForm"),message=$("#housekeepingReminderMessage");
  if(!form)return {load:async()=>{}};
  const fieldMap={contactName:"housekeepingContactName",email:"housekeepingReminderEmail",arrivalTime:"housekeepingArrivalTime",checkoutTime:"housekeepingCheckoutTime"};
  function showStatus(data){
    lastState=data;$("#housekeepingReminderStatus").textContent=data.settings?.enabled?"工作提醒已啟用。":"提醒尚未啟用，請先確認房務姓名、收件信箱與通知時間。";
    if(!data.schedulerConfigured)$("#housekeepingReminderStatus").textContent+=" 定時通知尚未接通。";
    $("#activateHousekeepingReminders").classList.toggle("hidden",!data.schedulerConfigured||!data.gmailConfigured||!data.settings?.ready||data.settings?.enabled===true);
  }
  async function load(){
    const month=$("#housekeepingReportMonth");if(!month.value)month.value=new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Taipei"}).slice(0,7);
    const root=$("#housekeepingReports");
    try{
      const response=await privateRequest(`/api/admin-housekeeping?month=${encodeURIComponent(month.value)}`,token),data=await response.json();
      if(!settingsLoaded){for(const [key,id]of Object.entries(fieldMap))$(`#${id}`).value=data.settings?.[key]||"";settingsLoaded=true;}
      showStatus(data);for(const dispose of disposers.splice(0))dispose();root.replaceChildren();
      if(!data.reports?.length){root.textContent="這個月份尚無整備完成紀錄。";return;}
      for(const report of data.reports){const card=document.createElement("article");card.className="housekeeping-report-card";const title=document.createElement("h4");title.textContent=`${report.checkoutDate} 退房・訂單 ${report.bookingId}`;const body=document.createElement("div");disposers.push(renderCompletedReport(body,report,token));card.append(title,body);root.append(card);}
    }catch(e){root.textContent="完成紀錄讀取失敗，請重新整理。";message.textContent=e.message;message.className="message error";}
  }
  async function save(activate=false){
    if(form.dataset.busy)return;
    const values=Object.fromEntries(Object.entries(fieldMap).map(([key,id])=>[key,$(`#${id}`).value]));
    if(activate&&(!lastState?.schedulerConfigured||!lastState.gmailConfigured))return;
    if(activate&&!confirm(`啟用 ${values.email} 的後續房務通知？\n只針對啟用後新確認預約，不回補歷史確認通知。`))return;
    form.dataset.busy="true";const controls=[...form.querySelectorAll("button,input")];controls.forEach(x=>x.disabled=true);message.className="message";message.textContent="正在儲存…";
    try{const response=await privateRequest("/api/admin-housekeeping",token,{...values,activate}),data=await response.json();settingsLoaded=true;showStatus(data);message.className="message success";message.textContent=activate?"後續工作提醒已啟用。":"設定已儲存，提醒保持停用。";}
    catch(e){message.className="message error";message.textContent=e.message;}
    finally{delete form.dataset.busy;controls.forEach(x=>x.disabled=false);}
  }
  form.addEventListener("submit",event=>{event.preventDefault();save();});$("#activateHousekeepingReminders").addEventListener("click",()=>save(true));$("#refreshHousekeepingReports").addEventListener("click",load);$("#housekeepingReportMonth").addEventListener("change",load);
  return {load};
}

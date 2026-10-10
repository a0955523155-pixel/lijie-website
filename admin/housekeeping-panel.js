import {privateRequest,renderCompletedReport} from "../housekeeping/report-form.js";
export function installHousekeepingAdmin(token){
  const $=selector=>document.querySelector(selector);let settingsLoaded=false,lastState=null,disposers=[],generation=0;const reviewRequests=new Map();
  const form=$("#housekeepingReminderForm"),message=$("#housekeepingReminderMessage");
  if(!form)return {load:async()=>{}};
  const fieldMap={contactName:"housekeepingContactName",email:"housekeepingReminderEmail",arrivalTime:"housekeepingArrivalTime",checkoutTime:"housekeepingCheckoutTime"};
  function showStatus(data){
    lastState=data;$("#housekeepingReminderStatus").textContent=data.settings?.enabled?"工作提醒已啟用。":"提醒尚未啟用，請先確認房務姓名、收件信箱與通知時間。";
    if(!data.schedulerConfigured)$("#housekeepingReminderStatus").textContent+=" 定時通知尚未接通。";
    $("#activateHousekeepingReminders").classList.toggle("hidden",!data.schedulerConfigured||!data.gmailConfigured||!data.settings?.ready||data.settings?.enabled===true);
  }
  function renderNotifications(jobs,enabled){
    const root=$("#housekeepingNotifications");root.replaceChildren();
    if(!jobs?.length){root.textContent="這個月份沒有提醒紀錄，也沒有寄送結果待確認的項目。";return;}
    const labels={pending:"待排程寄送",sending:"寄送結果待確認",delivery_uncertain:"寄送結果待確認",held_for_review:"寄送結果待確認",sent:"已交給郵件服務（未驗證送達）",manually_verified:"人工核對已寄出",suppressed:"同日已處理，未自動重寄",stale:"已失效"};
    for(const job of jobs){
      const card=document.createElement("article");card.className="housekeeping-report-card";card.dataset.notification=job.id;
      const title=document.createElement("h4");title.textContent=`${{confirmed:"確認通知",arrival:"入住提醒",checkout:"退房提醒"}[job.kind]||"工作提醒"}・${job.bookingId}`;
      const dates=document.createElement("p");dates.textContent=`${job.startDate} 入住 → ${job.endDate} 退房`;
      const state=document.createElement("p");state.className="message";state.textContent=job.effectiveStale&&job.status==="pending"?"已失效":labels[job.status]||"狀態需核對";
      card.append(title,dates,state);
      if(["sending","delivery_uncertain","held_for_review"].includes(job.status)){
        const warning=document.createElement("p");warning.textContent=job.effectiveStale?"此住宿已改期或取消，不能重排舊提醒；仍可核對先前的寄送結果。":"先核對寄件備份及收件狀況；重新排入可能造成重複信。";card.append(warning);
        const actions=document.createElement("div");actions.className="ops-order-actions";
        for(const [action,label] of [["verify_delivery","已人工核對寄出"],["requeue_notification","重新排入（不立即寄送）"]]){
          const button=document.createElement("button");button.type="button";button.className="secondary";button.textContent=label;
          const locked=action==="requeue_notification"&&(!enabled||job.effectiveStale);button.disabled=locked;button.dataset.locked=String(locked);if(locked)button.title=enabled?"住宿已失效，不能重排":"提醒停用中，啟用後才可重排";
          button.addEventListener("click",async()=>{
            if(card.dataset.busy)return;
            const prompt=action==="verify_delivery"?"已核對 Gmail 寄件備份或向房務確認這封信已寄出？此操作只記錄人工核對，不寄信。":"確定重新排入這封提醒？先前可能已寄出，因此可能重複寄送；這個操作不會立即寄信。";
            if(!confirm(prompt))return;card.dataset.busy="true";actions.querySelectorAll("button").forEach(b=>b.disabled=true);
            const key=`${job.id}:${job.attemptId}:${action}`;if(!reviewRequests.has(key))reviewRequests.set(key,crypto.randomUUID());
            try{await privateRequest("/api/admin-housekeeping",token,{action,notificationId:job.id,attemptId:job.attemptId,requestId:reviewRequests.get(key),verified:action==="verify_delivery",possibleDuplicateAck:action==="requeue_notification"});reviewRequests.delete(key);await load();$("#housekeepingNotificationMessage").textContent=action==="verify_delivery"?"人工核對已保存，沒有寄信。":"已重新排入，等待定時工作處理，沒有立即寄信。";}
            catch(e){$("#housekeepingNotificationMessage").textContent=e.message;delete card.dataset.busy;actions.querySelectorAll("button").forEach(b=>b.disabled=b.dataset.locked==="true");}
          });actions.append(button);
        }card.append(actions);
      }
      root.append(card);
    }
  }
  async function load(){
    const month=$("#housekeepingReportMonth");if(!month.value)month.value=new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Taipei"}).slice(0,7);
    const root=$("#housekeepingReports"),current=++generation;
    try{
      const response=await privateRequest(`/api/admin-housekeeping?month=${encodeURIComponent(month.value)}`,token),data=await response.json();
      if(current!==generation)return;
      if(!settingsLoaded){for(const [key,id]of Object.entries(fieldMap))$(`#${id}`).value=data.settings?.[key]||"";settingsLoaded=true;}
      showStatus(data);renderNotifications(data.notifications,data.settings?.enabled===true);for(const dispose of disposers.splice(0))dispose();root.replaceChildren();
      if(!data.reports?.length){root.textContent="這個月份尚無整備完成紀錄。";return;}
      for(const report of data.reports){const card=document.createElement("article");card.className="housekeeping-report-card";const title=document.createElement("h4");title.textContent=`${report.checkoutDate} 退房・訂單 ${report.bookingId}`;const body=document.createElement("div");disposers.push(renderCompletedReport(body,report,token));card.append(title,body);root.append(card);}
    }catch(e){if(current!==generation)return;root.textContent="完成紀錄讀取失敗，請重新整理。";$("#housekeepingNotifications").textContent="提醒狀態無法確認，請重新整理。";message.textContent=e.message;message.className="message error";}
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

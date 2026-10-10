const MAX_BYTES=500*1024;
const errors={REMINDERS_DISABLED:"提醒停用中，尚不能重新排入寄送。",NOTIFICATION_STILL_IN_FLIGHT:"先前寄送可能仍在處理，請至少等候 15 分鐘並核對寄件備份。",NOTIFICATION_NO_LONGER_APPLICABLE:"住宿已改期、取消或工作已完成，不能重寄舊提醒。",NOTIFICATION_REVIEW_CHANGED:"這筆寄送紀錄已變更，請重新整理後核對。",PHOTO_REQUIRED_FOR_THIS_STAY:"請先成功上傳這筆住宿的客廳照片。",INVALID_PHOTO:"照片無法使用，請改用 JPEG、PNG 或 WebP。",CHECKOUT_DATE_CHANGED:"住宿日期已變更，請重新整理後回報。",CHECKOUT_NOT_DUE:"尚未到退房日期。",BOOKING_NOT_CONFIRMED:"這筆住宿尚未確認或已取消。",REQUEST_ID_REUSED:"照片已變更，請重新選取後再試。"};
export async function privateRequest(path,token,body){
  let response;try{response=await fetch(path,{method:body?"POST":"GET",cache:"no-store",headers:{Authorization:`Bearer ${await token()}`,...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});}catch{throw new Error("連線中斷，內容已保留，請再試一次。");}
  if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(errors[data.error]||"資料未能儲存，請保留畫面再試一次。");}
  return response;
}
export async function compressRoomPhoto(file){
  if(!file||!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>10*1024*1024)throw new Error("請選擇 10 MB 以下的 JPEG、PNG 或 WebP 照片。");
  const url=URL.createObjectURL(file),image=new Image();
  try{
    image.src=url;await image.decode();
    if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>32000000)throw new Error("照片尺寸太大，請選取較小的照片。");
    const canvas=document.createElement("canvas"),ctx=canvas.getContext("2d");let result;
    for(const longest of [1600,1000]){
      const scale=Math.min(1,longest/Math.max(image.naturalWidth,image.naturalHeight));canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
      for(const quality of [.82,.66,.5,.35]){result=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",quality));if(result&&result.size<=MAX_BYTES)break;}
      if(result&&result.size<=MAX_BYTES)break;
    }
    if(!result||result.size>MAX_BYTES)throw new Error("照片仍太大，請選取較小的照片。");
    const bytes=new Uint8Array(await result.arrayBuffer());let binary="";for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);
  }catch(e){throw new Error(e.message||"照片讀取失敗，請重新選取。");}finally{URL.revokeObjectURL(url);}
}
export function renderCompletedReport(root,report,token){
  root.replaceChildren();root.className="completed-card";
  const title=document.createElement("strong");title.textContent="✓ 退房整備完成";
  const time=document.createElement("p");time.textContent=`${new Date(report.completedAt).toLocaleString("zh-TW",{timeZone:"Asia/Taipei"})}・${report.completedByEmail||report.completedBy}`;
  const note=document.createElement("p");note.textContent=report.note||"清潔完成，客廳照片已保存。";
  const button=document.createElement("button");button.type="button";button.className="ghost";button.textContent="查看確認照片";
  const message=document.createElement("p");message.className="message";message.setAttribute("aria-live","polite");
  const image=document.createElement("img");image.className="photo-preview hidden";image.alt="這筆住宿的客廳整潔確認照片";
  let blobUrl;button.addEventListener("click",async()=>{if(button.disabled)return;button.disabled=true;try{const response=await privateRequest(`/api/housekeeping-photo?id=${encodeURIComponent(report.photoId)}`,token);const blob=await response.blob();if(blobUrl)URL.revokeObjectURL(blobUrl);blobUrl=URL.createObjectURL(blob);image.src=blobUrl;image.classList.remove("hidden");message.textContent="";}catch(e){message.textContent=e.message;message.className="message error";}finally{button.disabled=false;}});
  root.append(title,time,note,button,message,image);
  return ()=>{if(blobUrl)URL.revokeObjectURL(blobUrl);};
}
export function createHousekeepingReportForm(booking,token,onComplete){
  const form=document.createElement("form");form.className="report-form";form.dataset.booking=booking.id;
  form.innerHTML='<h3>退房整備完成回報</h3><label class="check-label"><input name="cleaned" type="checkbox" required>已完成清潔整理</label><label>客廳整潔照片<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required></label><img class="photo-preview hidden" alt="選取的客廳照片"><label>簡短說明（可不填）<textarea name="note" maxlength="160" rows="2" placeholder="例如：清潔已完成，鑰匙已備妥"></textarea></label><button class="primary" type="submit">完成回報</button><p class="message" aria-live="polite"></p>';
  const message=form.querySelector(".message"),fileInput=form.elements.photo,preview=form.querySelector("img");let photoId=null,requestId=crypto.randomUUID(),busy=false,previewUrl;
  fileInput.addEventListener("change",()=>{photoId=null;requestId=crypto.randomUUID();if(previewUrl)URL.revokeObjectURL(previewUrl);const file=fileInput.files[0];if(file){previewUrl=URL.createObjectURL(file);preview.src=previewUrl;preview.classList.remove("hidden");}else preview.classList.add("hidden");});
  form.dispose=()=>{if(previewUrl)URL.revokeObjectURL(previewUrl);};
  form.addEventListener("submit",async event=>{
    event.preventDefault();if(busy)return;
    if(!form.elements.cleaned.checked||!fileInput.files[0]){message.textContent="請確認清潔完成，並選取一張客廳照片。";message.className="message error";return;}
    busy=true;const controls=[...form.querySelectorAll("input,textarea,button")];controls.forEach(x=>x.disabled=true);message.className="message";
    try{
      if(!photoId){message.textContent="正在保存客廳照片…";const photoBase64=await compressRoomPhoto(fileInput.files[0]);const result=await(await privateRequest("/api/housekeeping-photo",token,{bookingId:booking.id,startDate:booking.startDate,checkoutDate:booking.endDate,requestId,photoBase64})).json();if(!result.uploaded||!result.id)throw new Error("照片未成功保存，請再試一次。");photoId=result.id;}
      message.textContent="照片已保存，正在完成回報…";const result=await(await privateRequest("/api/housekeeping-report",token,{bookingId:booking.id,startDate:booking.startDate,checkoutDate:booking.endDate,photoId,cleaned:true,note:form.elements.note.value})).json();
      if(!result.report||result.report.status!=="completed")throw new Error("回報未完成，請再試一次。");
      if(previewUrl)URL.revokeObjectURL(previewUrl);onComplete(result.report);
    }catch(e){message.textContent=e.message;message.className="message error";}
    finally{busy=false;controls.forEach(x=>x.disabled=false);}
  });
  return form;
}

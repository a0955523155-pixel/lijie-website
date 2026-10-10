import crypto from "node:crypto";
import { bookingTransaction, getPrivateRecord } from "./firestore-admin.js";
import { requireHousekeeping } from "./housekeeping-auth.js";
import { requireAdmin } from "./admin-auth.js";

export const MAX_PHOTO_BYTES=500*1024;
const digest=value=>crypto.createHash("sha256").update(value).digest("hex");
export const reportId=(bookingId,date,startDate)=>`HK${digest(`${bookingId}\0${startDate}\0${date}`).slice(0,40)}`;
export const taipeiDay=(now=new Date())=>now.toLocaleDateString("en-CA",{timeZone:"Asia/Taipei"});
export function safeId(value){const id=String(value||"");if(!/^[A-Za-z0-9_-]{1,120}$/.test(id))throw new Error("INVALID_ID");return id;}
export async function requireHousekeepingOrAdmin(req){
  try{return {...await requireHousekeeping(req),role:"housekeeping"};}
  catch(e){if(e.message!=="HOUSEKEEPING_FORBIDDEN")throw e;return {...await requireAdmin(req),role:"admin"};}
}
function verifyStay(booking,startDate,date,now){
  if(!booking)throw new Error("BOOKING_NOT_FOUND");
  if(booking.isTest||booking.status!=="confirmed")throw new Error("BOOKING_NOT_CONFIRMED");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||booking.endDate!==date||booking.startDate!==startDate)throw new Error("CHECKOUT_DATE_CHANGED");
  if(date>taipeiDay(now))throw new Error("CHECKOUT_NOT_DUE");
}
function decodePhoto(base64){
  if(typeof base64!=="string"||base64.length>Math.ceil(MAX_PHOTO_BYTES/3)*4||base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw new Error("INVALID_PHOTO");
  const data=Buffer.from(base64,"base64");
  if(data.toString("base64")!==base64)throw new Error("INVALID_PHOTO");
  if(data.length<20||data.length>MAX_PHOTO_BYTES||data[0]!==255||data[1]!==216||data[2]!==255||data.at(-2)!==255||data.at(-1)!==217)throw new Error("INVALID_PHOTO");
  // Require a real baseline/progressive JPEG frame and bounded dimensions.
  let offset=2,frame=false;
  while(offset+4<data.length){
    if(data[offset++]!==255)throw new Error("INVALID_PHOTO");while(data[offset]===255)offset++;
    const marker=data[offset++];if(marker===0xda)break;
    if(marker===0xd8||marker===0xd9||marker===1||(marker>=0xd0&&marker<=0xd7))continue;
    const length=data.readUInt16BE(offset);if(length<2||offset+length>data.length)throw new Error("INVALID_PHOTO");
    if([0xc0,0xc1,0xc2].includes(marker)){
      if(length<8)throw new Error("INVALID_PHOTO");
      const height=data.readUInt16BE(offset+3),width=data.readUInt16BE(offset+5);
      if(!width||!height||width>1600||height>1600)throw new Error("INVALID_PHOTO");frame=true;
    }
    offset+=length;
  }
  if(!frame)throw new Error("INVALID_PHOTO");return data;
}
export async function uploadHousekeepingPhoto({bookingId,startDate,checkoutDate,requestId,photoBase64},actor,now=new Date()){
  safeId(bookingId);safeId(requestId);if(requestId.length<10)throw new Error("INVALID_REQUEST_ID");
  const photo=decodePhoto(photoBase64),hash=digest(photo),id=`HP${digest(`${actor.uid}\0${bookingId}\0${startDate}\0${checkoutDate}\0${requestId}`).slice(0,40)}`;
  return bookingTransaction(async tx=>{
    const booking=await tx.get(`bookings/${bookingId}`);verifyStay(booking,startDate,checkoutDate,now);
    const existing=await tx.get(`housekeepingPhotos/${id}`);
    if(existing){if(existing.sha256!==hash)throw new Error("REQUEST_ID_REUSED");return {id,uploaded:true,duplicate:true};}
    tx.set(`housekeepingPhotos/${id}`,{bookingId,startDate,checkoutDate,contentType:"image/jpeg",base64:photo.toString("base64"),sha256:hash,size:photo.length,uploadedBy:actor.uid,uploadedAt:now.toISOString()});
    return {id,uploaded:true,duplicate:false};
  });
}
export async function completeHousekeeping({bookingId,startDate,checkoutDate,photoId,cleaned,note=""},actor,now=new Date()){
  safeId(bookingId);safeId(photoId);if(cleaned!==true)throw new Error("CLEANING_CONFIRMATION_REQUIRED");
  const id=reportId(bookingId,checkoutDate,startDate);
  return bookingTransaction(async tx=>{
    const booking=await tx.get(`bookings/${bookingId}`);verifyStay(booking,startDate,checkoutDate,now);
    const report=await tx.get(`housekeepingReports/${id}`);
    if(report)return {...report,id,duplicate:true};
    const photo=await tx.get(`housekeepingPhotos/${photoId}`);
    if(!photo||photo.bookingId!==bookingId||photo.checkoutDate!==checkoutDate||photo.startDate!==startDate||photo.uploadedBy!==actor.uid||!photo.sha256||!photo.base64)throw new Error("PHOTO_REQUIRED_FOR_THIS_STAY");
    const record={bookingId,startDate,checkoutDate,status:"completed",photoId,photoCount:1,note:String(note).trim().slice(0,160),completedBy:actor.uid,completedByEmail:actor.email,completedAt:now.toISOString()};
    tx.set(`housekeepingReports/${id}`,record);
    return {...record,id,duplicate:false};
  });
}
export async function readHousekeepingPhoto(id){safeId(id);const photo=await getPrivateRecord(`housekeepingPhotos/${id}`);if(!photo)throw new Error("PHOTO_NOT_FOUND");return photo;}
export function housekeepingError(res,e){
  const code=String(e.message||e),status=/AUTH/.test(code)?401:/FORBIDDEN/.test(code)?403:/NOT_FOUND/.test(code)?404:/FIRESTORE/.test(code)?503:409;
  return res.status(status).json({ok:false,error:code});
}

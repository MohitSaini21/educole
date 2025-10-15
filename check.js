import moment from "moment-timezone";
const timeString = moment().tz("Asia/Kolkata").format("hh:mm A");
console.log(timeString);

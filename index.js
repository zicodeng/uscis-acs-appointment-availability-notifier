const signale = require('signale');
const axios = require('axios');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const { titleCase } = require('title-case');
const { differenceInMinutes } = require('date-fns');

require('dotenv').config();

const GCP_OAUTH_CLIENT_ID = process.env.GCP_OAUTH_CLIENT_ID;
const GCP_OAUTH_CLEINT_SECRET = process.env.GCP_OAUTH_CLEINT_SECRET;
const GCP_OAUTH_REDIRECT_URI = process.env.GCP_OAUTH_REDIRECT_URI;
const GCP_OAUTH_REFRESH_TOKEN = process.env.GCP_OAUTH_REFRESH_TOKEN;
const GCP_OAUTH_USER = process.env.GCP_OAUTH_USER;

const EMAIL_TO = process.env.EMAIL_TO;
const IRCC_NUM = process.env.IRCC_NUM;

const oAuth2Client = new google.auth.OAuth2(
  GCP_OAUTH_CLIENT_ID,
  GCP_OAUTH_CLEINT_SECRET,
  GCP_OAUTH_REDIRECT_URI,
);
oAuth2Client.setCredentials({ refresh_token: GCP_OAUTH_REFRESH_TOKEN });

const USCIS_ACS_APPT_SCHEDULER_URL =
  'https://my.uscis.gov/appointmentscheduler-appointment/field-offices/zipcode';

const checkApptAvailabilityInWA = async () => {
  try {
    const res = await axios.get(`${USCIS_ACS_APPT_SCHEDULER_URL}/98168`);
    const data = res?.data;
    return data?.[0]?.timeSlots?.length > 0;
  } catch (error) {
    console.log(error);

    return false;
  }
};

const checkApptAvailabilityInNV = async () => {
  try {
    const res = await axios.get(`${USCIS_ACS_APPT_SCHEDULER_URL}/89118`);
    const data = res?.data;
    return (
      data?.[0]?.timeSlots?.find((timeSlot) =>
        ['2022-07-05', '2022-07-06'].includes(timeSlot.date),
      ) != undefined
    );
  } catch (error) {
    console.log(error);

    return false;
  }
};

const sleep = (second) =>
  new Promise((resolve) => setTimeout(resolve, Math.ceil(second * 1000)));

const sendEmail = async (subject) => {
  const accessToken = await oAuth2Client.getAccessToken();
  const transport = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user: GCP_OAUTH_USER,
      clientId: GCP_OAUTH_CLIENT_ID,
      clientSecret: GCP_OAUTH_CLEINT_SECRET,
      refreshToken: GCP_OAUTH_REFRESH_TOKEN,
      accessToken: accessToken,
    },
  });

  await transport.sendMail({
    from: `USCIS ACS Appointment Availability Notifier <${EMAIL_TO}>`,
    to: EMAIL_TO,
    subject: subject,
    html: `<p>IRCC Number: ${IRCC_NUM}</p><a href="https://my.uscis.gov/appointmentscheduler-appointment/ca/en/office-search">https://my.uscis.gov/appointmentscheduler-appointment/ca/en/office-search</a>`,
  });
};

(async () => {
  let retryCnt = 1;
  let WAApptAvailNotifTime = null;
  let NVApptAvailNotifTime = null;

  while (true) {
    const [isApptAvailInWA, isApptAvailInNV] = await Promise.all([
      checkApptAvailabilityInWA(),
      checkApptAvailabilityInNV(),
    ]);
    const now = new Date();
    const nowStr = now.toLocaleString();

    if (isApptAvailInWA) {
      const subject = `[${retryCnt}] WA appointment availability found at ${nowStr}`;
      signale.success(subject);

      if (
        WAApptAvailNotifTime == null ||
        Math.abs(differenceInMinutes(WAApptAvailNotifTime, now)) >= 10
      ) {
        await sendEmail(titleCase(subject));
        WAApptAvailNotifTime = now;
      }
    }

    if (isApptAvailInNV) {
      const subject = `[${retryCnt}] NV appointment availability found at ${nowStr}`;
      signale.success(subject);

      if (
        NVApptAvailNotifTime == null ||
        Math.abs(differenceInMinutes(NVApptAvailNotifTime, now)) >= 30
      ) {
        await sendEmail(titleCase(subject));
        NVApptAvailNotifTime = now;
      }
    }

    if (!isApptAvailInWA && !isApptAvailInNV) {
      signale.info(
        `[${retryCnt}] Appointment availability not found. Keep looking...`,
      );
    }

    await sleep(2); // API is rate limited
    retryCnt++;
  }
})();

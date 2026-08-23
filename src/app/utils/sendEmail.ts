import nodemailer from 'nodemailer';
import config from '../config';
import AppError from '../errors/AppError';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: Number(config.email.port) || 587,
  //secure: config.env === 'production',
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

export const sendEmail = async (to: string, html: string, subject: string) => {

  try {
    await transporter.sendMail({
      from: config.email.from || '"Your App" <noreply@example.com>',
      to,
      subject,
      html: html,
    });
  } catch (error) {
    console.error('Email Error:', error);
    throw new AppError(500, 'Email could not be sent');
  }
};

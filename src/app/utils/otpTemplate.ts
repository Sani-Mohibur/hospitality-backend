export const otpTemplate = (otp: string) => {
    return `
  <!DOCTYPE html>
  <html>
  <head>
    <style>
      .container {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        max-width: 500px;
        margin: 0 auto;
        padding: 20px;
        border: 1px solid #e0e0e0;
        border-radius: 10px;
      }
      .header {
        text-align: center;
        padding-bottom: 20px;
      }
      .otp-box {
        background-color: #f3f4f6;
        padding: 20px;
        text-align: center;
        border-radius: 8px;
        margin: 20px 0;
      }
      .otp-code {
        font-size: 32px;
        font-weight: bold;
        color: #2563eb;
        letter-spacing: 8px;
        margin: 0;
      }
      .footer {
        font-size: 12px;
        color: #6b7280;
        text-align: center;
        margin-top: 20px;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h2 style="color: #1f2937;">Verify Your Account</h2>
      </div>
      <p style="color: #4b5563;">Hello,</p>
      <p style="color: #4b5563;">Use the following One-Time Password (OTP) to complete your verification process. This code is valid for a limited time.</p>
      
      <div class="otp-box">
        <h1 class="otp-code">${otp}</h1>
      </div>

      <p style="color: #4b5563;">If you did not request this code, please ignore this email or contact support.</p>
      
      <div class="footer">
        <p>&copy; ${new Date().getFullYear()} Your App Name. All rights reserved.</p>
      </div>
    </div>
  </body>
  </html>
  `;
};
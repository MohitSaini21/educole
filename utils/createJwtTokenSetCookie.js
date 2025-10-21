import jwt from "jsonwebtoken";

/**
 * Generate a JWT token and set it in a cookie
 * @param {object} res - Express response object
 * @param {string} id - User or bus ID
 * @param {string} role - Optional role (e.g., 'driver', 'admin'); if omitted, treated as a bus
 * @returns {string} - The JWT token
 */
export const generateTokenAndSetCookie = async (res, id, role = "") => {
  try {
    // ✅ Create token payload
    const payload = role ? { id, role } : { id };

    // ✅ Set token expiration
    const expiresIn = role ? "30d" : "1d";

    // ✅ Sign the token
    const token = jwt.sign(payload, "Secret String", { expiresIn });

    // ✅ Set appropriate cookie name and duration
    const cookieName = role ? "authToken" : "busToken";
    const maxAge = role ? 30 * 24 * 60 * 60 * 1000 : 1 * 24 * 60 * 60 * 1000; // in ms

    res.cookie(cookieName, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge,
    });

    return token;
  } catch (error) {
    console.error(
      `❌ Error generating token or setting cookie: ${error.message}`
    );
    throw new Error("Failed to generate token"); // Let the caller handle it if needed
  }
};

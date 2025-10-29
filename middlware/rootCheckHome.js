import jwt from "jsonwebtoken"; // Importing the JWT library to handle JSON Web Token operations

// Middleware function to check if the user is authenticated and prevent access to the home page if logged in
export const checkAuthHome = (req, res, next) => {
  try {
    // Step 1: Get the authentication token from the cookies sent by the client
    const token = req.cookies.authToken;

    // Step 2: If the token is found, verify it
    if (token) {
      // Verify the token using the secret key stored in environment variables
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || "Secret String"
      );

      // Step 3: If the token is valid, print the payload (user data) and attach it to the request object

      req.user = decoded; // Attach the decoded user data to the request object

      if (decoded.role == "driver" || decoded.role == "conductor") {
        return res.redirect("/DC");
      } else if (decoded.role == "admin" || decoded.role == "administrator") {
        return res.redirect("/admin");
      }
    }

    // Step 5: If no token is found, allow the request to proceed to the home page or login/signup pages
    return next();
  } catch (error) {
    // Step 6: If an error occurs during token verification (e.g., invalid or expired token), handle it
    console.error("Authentication error:", error); // Log the error for debugging

    // Step 7: Redirect to the home page if any error occurs
    return next();
  }
};

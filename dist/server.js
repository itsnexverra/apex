// server.js
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

// src/server/mongodb.ts
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();
var client = null;
var db = null;
var connectionError = null;
var isConnected = false;
var localUsersStore = [];
var localCouponsStore = [
  { id: "cp_1", code: "APEX10", discountType: "percentage", discountValue: 10, isActive: true, createdAt: (/* @__PURE__ */ new Date()).toISOString() },
  { id: "cp_2", code: "WELCOME20", discountType: "percentage", discountValue: 20, isActive: true, createdAt: (/* @__PURE__ */ new Date()).toISOString() },
  { id: "cp_3", code: "STUDENT50", discountType: "fixed", discountValue: 50, isActive: true, createdAt: (/* @__PURE__ */ new Date()).toISOString() }
];
var localCoursesStore = [];
var ADMIN_USER = {
  id: "admin_001",
  name: "Apex Administrator",
  email: "admin@apexeducation.com",
  phone: "+1 (555) 019-2000",
  password: "admin123",
  enrolledCourses: [],
  createdAt: (/* @__PURE__ */ new Date()).toISOString(),
  isAdmin: true
};
localUsersStore.push({ ...ADMIN_USER });
function getDBStatus() {
  let uri = process.env.MONGODB_URI || "mongodb+srv://itsnexverra_db_user:<db_password>@cluster0.kyzrgp8.mongodb.net/?appName=Cluster0";
  if (uri.includes("@")) {
    const parts = uri.split("@");
    const credentials = parts[0].split("//")[1];
    if (credentials && credentials.includes(":")) {
      const user = credentials.split(":")[0];
      uri = `mongodb+srv://${user}:****@${parts[1]}`;
    }
  }
  return {
    status: isConnected ? "connected" : "fallback",
    provider: isConnected ? "mongodb" : "memory",
    uri,
    error: connectionError
  };
}
async function getDb() {
  if (db) return db;
  let uri = process.env.MONGODB_URI;
  if (!uri) {
    uri = "mongodb+srv://itsnexverra_db_user:<db_password>@cluster0.kyzrgp8.mongodb.net/?appName=Cluster0";
  }
  if (uri.includes("<db_password>")) {
    const dbPassword = process.env.DB_PASSWORD || process.env.MONGODB_PASSWORD;
    if (dbPassword) {
      uri = uri.replace("<db_password>", dbPassword);
    } else {
      connectionError = "MongoDB URI contains '<db_password>' placeholder. Please set your DB_PASSWORD in secrets or configure a full MONGODB_URI.";
      isConnected = false;
      return null;
    }
  }
  try {
    console.log("Connecting to MongoDB...");
    client = new MongoClient(uri, {
      connectTimeoutMS: 5e3,
      serverSelectionTimeoutMS: 5e3
    });
    await client.connect();
    db = client.db();
    isConnected = true;
    connectionError = null;
    console.log("Successfully connected to MongoDB");
    try {
      const usersCol = db.collection("users");
      const adminInDb = await usersCol.findOne({ email: ADMIN_USER.email });
      if (!adminInDb) {
        await usersCol.insertOne({ ...ADMIN_USER });
        console.log("Admin user seeded in MongoDB.");
      }
    } catch (err) {
      console.error("Failed to check/seed admin in MongoDB:", err);
    }
    return db;
  } catch (err) {
    isConnected = false;
    connectionError = err.message || "Failed to connect to MongoDB";
    console.warn("MongoDB connection failed, falling back to local memory storage:", connectionError);
    return null;
  }
}
async function dbFindUserByEmail(email) {
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail === ADMIN_USER.email.toLowerCase()) {
    const database2 = await getDb();
    if (database2) {
      try {
        const col = database2.collection("users");
        const adminInDb = await col.findOne({ email: normalizedEmail });
        if (adminInDb) return adminInDb;
      } catch (err) {
        console.error("Error fetching admin from DB, returning in-memory:", err);
      }
    }
    return { ...ADMIN_USER };
  }
  const database = await getDb();
  if (database) {
    try {
      const col = database.collection("users");
      return await col.findOne({ email: normalizedEmail });
    } catch (err) {
      console.error("MongoDB find user error:", err);
    }
  }
  return localUsersStore.find((u) => u.email.toLowerCase() === normalizedEmail) || null;
}
async function dbCreateUser(user) {
  const database = await getDb();
  if (database) {
    try {
      const col = database.collection("users");
      await col.insertOne({ ...user });
      return user;
    } catch (err) {
      console.error("MongoDB create user error:", err);
    }
  }
  localUsersStore.push(user);
  return user;
}
async function dbGetAllUsers() {
  const database = await getDb();
  if (database) {
    try {
      const col = database.collection("users");
      return await col.find({}).toArray();
    } catch (err) {
      console.error("MongoDB get all users error:", err);
    }
  }
  return localUsersStore;
}
async function dbSaveUser(user) {
  const database = await getDb();
  if (database) {
    try {
      const col = database.collection("users");
      await col.updateOne({ id: user.id }, { $set: user }, { upsert: true });
      return user;
    } catch (err) {
      console.error("MongoDB save user error:", err);
    }
  }
  const index = localUsersStore.findIndex((u) => u.id === user.id);
  if (index !== -1) {
    localUsersStore[index] = user;
  } else {
    localUsersStore.push(user);
  }
  return user;
}
async function dbDeleteUser(userId) {
  if (userId === ADMIN_USER.id) {
    throw new Error("Cannot delete primary administrator account.");
  }
  const database = await getDb();
  if (database) {
    try {
      const col = database.collection("users");
      const res = await col.deleteOne({ id: userId });
      return res.deletedCount > 0;
    } catch (err) {
      console.error("MongoDB delete user error:", err);
    }
  }
  const index = localUsersStore.findIndex((u) => u.id === userId);
  if (index !== -1) {
    localUsersStore.splice(index, 1);
    return true;
  }
  return false;
}
async function dbUpdateUserCourses(userId, enrolledCourses, phone, name) {
  const database = await getDb();
  if (database) {
    try {
      const col = database.collection("users");
      const updateDoc = { $set: { enrolledCourses } };
      if (phone) updateDoc.$set.phone = phone;
      if (name) updateDoc.$set.name = name;
      const result = await col.findOneAndUpdate(
        { id: userId },
        updateDoc,
        { returnDocument: "after" }
      );
      if (result) {
        const doc = result && typeof result === "object" && "value" in result ? result.value : result;
        return doc;
      }
    } catch (err) {
      console.error("MongoDB update user error:", err);
    }
  }
  const user = localUsersStore.find((u) => u.id === userId);
  if (user) {
    user.enrolledCourses = enrolledCourses;
    if (phone) user.phone = phone;
    if (name) user.name = name;
    return user;
  }
  return null;
}
async function dbGetCourses(defaultCourses) {
  if (localCoursesStore.length === 0) {
    localCoursesStore = [...defaultCourses];
  }
  const database = await getDb();
  if (database) {
    try {
      const col = database.collection("courses");
      const courses = await col.find({}).toArray();
      if (courses.length === 0 && defaultCourses.length > 0) {
        await col.insertMany(defaultCourses);
        return defaultCourses;
      }
      return courses;
    } catch (err) {
      console.error("MongoDB get courses error:", err);
    }
  }
  return localCoursesStore;
}
async function dbAddCourse(course) {
  const database = await getDb();
  if (database) {
    try {
      const col = database.collection("courses");
      await col.insertOne(course);
      return course;
    } catch (err) {
      console.error("MongoDB add course error:", err);
    }
  }
  localCoursesStore.push(course);
  return course;
}
async function dbDeleteCourse(courseId) {
  const database = await getDb();
  if (database) {
    try {
      const col = database.collection("courses");
      const res = await col.deleteOne({ id: courseId });
      return res.deletedCount > 0;
    } catch (err) {
      console.error("MongoDB delete course error:", err);
    }
  }
  const index = localCoursesStore.findIndex((c) => c.id === courseId);
  if (index !== -1) {
    localCoursesStore.splice(index, 1);
    return true;
  }
  return false;
}
async function dbUpdateCourse(courseId, updatedFields) {
  const database = await getDb();
  if (database) {
    try {
      const col = database.collection("courses");
      const result = await col.findOneAndUpdate(
        { id: courseId },
        { $set: updatedFields },
        { returnDocument: "after" }
      );
      if (result) {
        const doc = result && typeof result === "object" && "value" in result ? result.value : result;
        return doc;
      }
    } catch (err) {
      console.error("MongoDB update course error:", err);
    }
  }
  const index = localCoursesStore.findIndex((c) => c.id === courseId);
  if (index !== -1) {
    localCoursesStore[index] = { ...localCoursesStore[index], ...updatedFields };
    return localCoursesStore[index];
  }
  return null;
}
async function dbGetCoupons() {
  const database = await getDb();
  if (database) {
    try {
      const col = database.collection("coupons");
      const coupons = await col.find({}).toArray();
      if (coupons.length === 0) {
        await col.insertMany(localCouponsStore);
        return localCouponsStore;
      }
      return coupons;
    } catch (err) {
      console.error("MongoDB get coupons error:", err);
    }
  }
  return localCouponsStore;
}
async function dbAddCoupon(coupon) {
  const database = await getDb();
  if (database) {
    try {
      const col = database.collection("coupons");
      await col.insertOne(coupon);
      return coupon;
    } catch (err) {
      console.error("MongoDB add coupon error:", err);
    }
  }
  localCouponsStore.push(coupon);
  return coupon;
}
async function dbToggleCoupon(couponId, isActive) {
  const database = await getDb();
  if (database) {
    try {
      const col = database.collection("coupons");
      const res = await col.updateOne({ id: couponId }, { $set: { isActive } });
      return res.modifiedCount > 0;
    } catch (err) {
      console.error("MongoDB toggle coupon error:", err);
    }
  }
  const coupon = localCouponsStore.find((c) => c.id === couponId);
  if (coupon) {
    coupon.isActive = isActive;
    return true;
  }
  return false;
}
async function dbDeleteCoupon(couponId) {
  const database = await getDb();
  if (database) {
    try {
      const col = database.collection("coupons");
      const res = await col.deleteOne({ id: couponId });
      return res.deletedCount > 0;
    } catch (err) {
      console.error("MongoDB delete coupon error:", err);
    }
  }
  const index = localCouponsStore.findIndex((c) => c.id === couponId);
  if (index !== -1) {
    localCouponsStore.splice(index, 1);
    return true;
  }
  return false;
}

// src/data.ts
var COURSES = [
  {
    id: "1",
    title: "Professional Ceramic Moulding for Beginners",
    category: "it-software",
    // In the original image it is labeled 'Data Science', but categories listed 'IT & Software'. Let's group flexibly!
    tag: "Data Science",
    price: 150,
    rating: 5,
    reviewCount: 28,
    lessons: 3,
    hours: 8,
    image: "/assets/images/ceramic_moulding_course_1782236623933.jpg",
    description: "Learn the secrets of master ceramic moulding, handcrafting techniques, and contour shaping from professional sculptors.",
    videoUrl: "https://www.youtube.com/watch?v=k_l9N9g_EKA",
    lessonsList: [
      { id: "1_1", title: "1.1 Introduction to Ceramic Art & Moulding", videoUrl: "https://www.youtube.com/watch?v=k_l9N9g_EKA", duration: "05:20" },
      { id: "1_2", title: "1.2 Understanding Clay Hydration & Kneading", videoUrl: "https://www.youtube.com/watch?v=vVj_q9gLzXU", duration: "08:45" },
      { id: "1_3", title: "1.3 Handcrafting Techniques & Contour Shaping", videoUrl: "https://www.youtube.com/watch?v=I67YjW-X7fM", duration: "12:15" }
    ]
  },
  {
    id: "2",
    title: "Ultimate Photoshop Training: From Beginner to Pro",
    category: "digital-program",
    tag: "Management",
    price: 120,
    rating: 5,
    reviewCount: 28,
    lessons: 3,
    hours: 8,
    image: "/assets/images/photoshop_training_course_1782236638058.jpg",
    description: "Master the entire Adobe Photoshop toolkit. Learn professional retouching, graphic design, and vector editing techniques.",
    videoUrl: "https://www.youtube.com/watch?v=F_b_pS_O13Y",
    lessonsList: [
      { id: "2_1", title: "2.1 Photoshop Professional Workspace Tour", videoUrl: "https://www.youtube.com/watch?v=F_b_pS_O13Y", duration: "06:15" },
      { id: "2_2", title: "2.2 Mastering Vector Selection & Pen Tools", videoUrl: "https://www.youtube.com/watch?v=2CoGgVshbDo", duration: "11:30" },
      { id: "2_3", title: "2.3 Non-Destructive Editing with Layer Masks", videoUrl: "https://www.youtube.com/watch?v=gT8Y5eXzW5w", duration: "14:20" }
    ]
  },
  {
    id: "3",
    title: "Basic Fundamentals of Interior & Graphics Design",
    category: "ui-ux-design",
    tag: "Graphics",
    price: 170,
    rating: 5,
    reviewCount: 28,
    lessons: 2,
    hours: 8,
    image: "/assets/images/interior_graphics_course_1782236649860.jpg",
    description: "A comprehensive dive into interior space planning, architectural elements, and color theory principles.",
    videoUrl: "https://www.youtube.com/watch?v=7uV858hbyWw",
    lessonsList: [
      { id: "3_1", title: "3.1 Foundational Principles of Interior Design", videoUrl: "https://www.youtube.com/watch?v=7uV858hbyWw", duration: "07:40" },
      { id: "3_2", title: "3.2 Application of Color Theory in Space Planning", videoUrl: "https://www.youtube.com/watch?v=Yp69b_tM970", duration: "10:15" }
    ]
  },
  {
    id: "4",
    title: "WordPress for Beginners - Master WordPress Website Building",
    category: "website-design",
    tag: "Development",
    price: 140,
    rating: 5,
    reviewCount: 28,
    lessons: 3,
    hours: 8,
    image: "/assets/images/wordpress_beginners_course_1782236663469.jpg",
    description: "Build high-performance websites without any code using the Gutenberg block editor and professional WordPress themes.",
    videoUrl: "https://www.youtube.com/watch?v=8O98_2V4Hco",
    lessonsList: [
      { id: "4_1", title: "4.1 Hosting & Domain Setup for WordPress", videoUrl: "https://www.youtube.com/watch?v=8O98_2V4Hco", duration: "05:50" },
      { id: "4_2", title: "4.2 WordPress Core Dashboard Navigation", videoUrl: "https://www.youtube.com/watch?v=d_Z9gO_9v7w", duration: "09:20" },
      { id: "4_3", title: "4.3 Theme Customization & Block Gutenberg Editor", videoUrl: "https://www.youtube.com/watch?v=1F_84l00kRE", duration: "15:10" }
    ]
  }
];

// server.js
var app = express();
app.use(express.json());
getDb().catch((err) => {
  console.warn("Initial MongoDB connection attempt deferred or failed:", err.message);
});
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
});
app.get("/api/db-status", (req, res) => {
  res.json(getDBStatus());
});
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: "Name and email are required fields." });
    }
    const existingUser = await dbFindUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ error: "An account with this email address already exists." });
    }
    const newUser = {
      id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: (phone || "").trim(),
      password: password || "Welcome123",
      enrolledCourses: [],
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    const created = await dbCreateUser(newUser);
    const { password: _, ...safeUser } = created;
    res.status(201).json({ user: safeUser });
  } catch (err) {
    console.error("Register endpoint error:", err);
    res.status(500).json({ error: err.message || "Server error during registration." });
  }
});
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }
    const user = await dbFindUserByEmail(email);
    if (!user) {
      return res.status(404).json({ error: "No account found with this email address." });
    }
    if (user.password !== password) {
      return res.status(401).json({ error: "Incorrect password. Please try again." });
    }
    const { password: _, ...safeUser } = user;
    res.json({ user: safeUser });
  } catch (err) {
    console.error("Login endpoint error:", err);
    res.status(500).json({ error: err.message || "Server error during login." });
  }
});
app.post("/api/auth/enroll", async (req, res) => {
  try {
    const { name, email, phone, courseId } = req.body;
    if (!name || !email || !courseId) {
      return res.status(400).json({ error: "Name, email, and course ID are required." });
    }
    const existingUser = await dbFindUserByEmail(email);
    let user = existingUser;
    let isNew = false;
    let autoPassword = "";
    if (!user) {
      autoPassword = `Apex@${Math.floor(1e3 + Math.random() * 9e3)}`;
      const newUser = {
        id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: (phone || "").trim(),
        password: autoPassword,
        enrolledCourses: [courseId],
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      user = await dbCreateUser(newUser);
      isNew = true;
    } else {
      const updatedCourses = user.enrolledCourses.includes(courseId) ? user.enrolledCourses : [...user.enrolledCourses, courseId];
      user = await dbUpdateUserCourses(
        user.id,
        updatedCourses,
        (phone || "").trim() || user.phone,
        name.trim() || user.name
      );
    }
    if (!user) {
      return res.status(500).json({ error: "Failed to find or update student account." });
    }
    const { password: _, ...safeUser } = user;
    res.json({
      user: safeUser,
      isNew,
      autoPassword: isNew ? autoPassword : void 0
    });
  } catch (err) {
    console.error("Enroll endpoint error:", err);
    res.status(500).json({ error: err.message || "Server error during enrollment." });
  }
});
app.get("/api/courses", async (req, res) => {
  try {
    const courses = await dbGetCourses(COURSES);
    res.json(courses);
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to fetch courses." });
  }
});
app.post("/api/courses", async (req, res) => {
  try {
    const { importUrl, title, category, tag, price, lessons, hours, image, description } = req.body;
    if (importUrl) {
      try {
        console.log(`Attempting to import courses from URL: ${importUrl}`);
        const fetchRes = await fetch(importUrl);
        if (!fetchRes.ok) {
          throw new Error(`Remote server responded with status ${fetchRes.status}`);
        }
        const data = await fetchRes.json();
        const importedCourses = [];
        const processCourseObj = async (item) => {
          const id = item.id || `course_${Date.now()}_${Math.floor(Math.random() * 1e4)}`;
          const cleanCourse = {
            id,
            title: item.title || "Untitled Dynamic Course",
            category: item.category || "it-software",
            tag: item.tag || "New",
            price: Number(item.price) || 0,
            rating: Number(item.rating) || 5,
            reviewCount: Number(item.reviewCount) || 1,
            lessons: Number(item.lessons) || 10,
            hours: Number(item.hours) || 2,
            image: item.image || "/assets/images/photoshop_training_course_1782236638058.jpg",
            description: item.description || ""
          };
          await dbAddCourse(cleanCourse);
          importedCourses.push(cleanCourse);
        };
        if (Array.isArray(data)) {
          for (const item of data) {
            await processCourseObj(item);
          }
        } else if (typeof data === "object" && data !== null) {
          await processCourseObj(data);
        } else {
          return res.status(400).json({ error: "URL did not return a valid course array or object." });
        }
        return res.status(201).json({ message: `Successfully imported ${importedCourses.length} course(s).`, courses: importedCourses });
      } catch (fetchErr) {
        return res.status(400).json({ error: `Failed to download or parse course data from URL link: ${fetchErr.message}` });
      }
    }
    if (!title || !category) {
      return res.status(400).json({ error: "Title and category are required." });
    }
    const newCourse = {
      id: `course_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      title,
      category,
      tag: tag || "General",
      price: Number(price) || 0,
      rating: 5,
      reviewCount: 1,
      lessons: Number(lessons) || 12,
      hours: Number(hours) || 4,
      image: image || "/assets/images/photoshop_training_course_1782236638058.jpg",
      description: description || ""
    };
    const added = await dbAddCourse(newCourse);
    res.status(201).json(added);
  } catch (err) {
    console.error("Add course error:", err);
    res.status(500).json({ error: err.message || "Server error creating course." });
  }
});
app.delete("/api/courses/:id", async (req, res) => {
  try {
    const deleted = await dbDeleteCourse(req.params.id);
    res.json({ success: deleted });
  } catch (err) {
    res.status(500).json({ error: err.message || "Server error deleting course." });
  }
});
app.put("/api/courses/:id", async (req, res) => {
  try {
    const { title, category, tag, price, lessons, hours, image, description, videoUrl, lessonsList } = req.body;
    const updateFields = {};
    if (title !== void 0) updateFields.title = title;
    if (category !== void 0) updateFields.category = category;
    if (tag !== void 0) updateFields.tag = tag;
    if (price !== void 0) updateFields.price = Number(price);
    if (lessons !== void 0) updateFields.lessons = Number(lessons);
    if (hours !== void 0) updateFields.hours = Number(hours);
    if (image !== void 0) updateFields.image = image;
    if (description !== void 0) updateFields.description = description;
    if (videoUrl !== void 0) updateFields.videoUrl = videoUrl;
    if (lessonsList !== void 0) updateFields.lessonsList = lessonsList;
    const updated = await dbUpdateCourse(req.params.id, updateFields);
    if (!updated) {
      return res.status(404).json({ error: "Course not found." });
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message || "Server error updating course." });
  }
});
app.get("/api/coupons", async (req, res) => {
  try {
    const coupons = await dbGetCoupons();
    res.json(coupons);
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to fetch coupons." });
  }
});
app.post("/api/coupons", async (req, res) => {
  try {
    const { code, discountType, discountValue } = req.body;
    if (!code || !discountType || discountValue === void 0) {
      return res.status(400).json({ error: "Code, discount type, and value are required." });
    }
    const newCoupon = {
      id: `coupon_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      code: code.trim().toUpperCase(),
      discountType,
      discountValue: Number(discountValue),
      isActive: true,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    const added = await dbAddCoupon(newCoupon);
    res.status(201).json(added);
  } catch (err) {
    res.status(500).json({ error: err.message || "Server error creating coupon." });
  }
});
app.post("/api/coupons/toggle", async (req, res) => {
  try {
    const { id, isActive } = req.body;
    const updated = await dbToggleCoupon(id, isActive);
    res.json({ success: updated });
  } catch (err) {
    res.status(500).json({ error: err.message || "Server error toggling coupon." });
  }
});
app.delete("/api/coupons/:id", async (req, res) => {
  try {
    const deleted = await dbDeleteCoupon(req.params.id);
    res.json({ success: deleted });
  } catch (err) {
    res.status(500).json({ error: err.message || "Server error deleting coupon." });
  }
});
app.post("/api/coupons/validate", async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: "Coupon code is required." });
    }
    const coupons = await dbGetCoupons();
    const match = coupons.find((c) => c.code === code.trim().toUpperCase());
    if (!match) {
      return res.status(404).json({ error: "Invalid coupon code." });
    }
    if (!match.isActive) {
      return res.status(400).json({ error: "This coupon is no longer active." });
    }
    res.json(match);
  } catch (err) {
    res.status(500).json({ error: err.message || "Server error validating coupon." });
  }
});
app.get("/api/admin/users", async (req, res) => {
  try {
    const users = await dbGetAllUsers();
    const safeUsers = users.map((u) => {
      const { password, ...safe } = u;
      return { ...safe, hasPassword: !!password };
    });
    res.json(safeUsers);
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to fetch users list." });
  }
});
app.post("/api/admin/users/save", async (req, res) => {
  try {
    const { id, name, email, phone, enrolledCourses, isAdmin, password } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: "Name and email are required." });
    }
    let userToSave;
    if (id) {
      const allUsers = await dbGetAllUsers();
      const existing = allUsers.find((u) => u.id === id);
      if (!existing) {
        return res.status(404).json({ error: "User not found." });
      }
      userToSave = {
        ...existing,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: (phone || "").trim(),
        enrolledCourses: enrolledCourses || existing.enrolledCourses,
        isAdmin: isAdmin !== void 0 ? isAdmin : existing.isAdmin
      };
      if (password) {
        userToSave.password = password;
      }
    } else {
      const existing = await dbFindUserByEmail(email);
      if (existing) {
        return res.status(400).json({ error: "Email already registered." });
      }
      userToSave = {
        id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: (phone || "").trim(),
        password: password || "Welcome123",
        enrolledCourses: enrolledCourses || [],
        isAdmin: !!isAdmin,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    const saved = await dbSaveUser(userToSave);
    const { password: _, ...safeUser } = saved;
    res.json(safeUser);
  } catch (err) {
    console.error("Save user error:", err);
    res.status(500).json({ error: err.message || "Server error saving user details." });
  }
});
app.delete("/api/admin/users/:id", async (req, res) => {
  try {
    const deleted = await dbDeleteUser(req.params.id);
    res.json({ success: deleted });
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to delete student." });
  }
});
app.post("/api/admin/users/enroll", async (req, res) => {
  try {
    const { userId, enrolledCourses } = req.body;
    if (!userId || !enrolledCourses) {
      return res.status(400).json({ error: "User ID and enrolledCourses array are required." });
    }
    const updated = await dbUpdateUserCourses(userId, enrolledCourses);
    if (!updated) {
      return res.status(404).json({ error: "User not found." });
    }
    const { password: _, ...safeUser } = updated;
    res.json(safeUser);
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to update user enrollment." });
  }
});
var server_default = app;
var isVercel = process.env.VERCEL === "1" || !!process.env.NOW_BUILDER;
if (!isVercel) {
  const PORT = process.env.BACKEND_PORT || process.env.PORT || 3001;
  if (process.env.NODE_ENV !== "production" && !process.env.VITE_STANDALONE) {
    createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    }).then((vite) => {
      app.use(vite.middlewares);
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server running on http://localhost:${PORT}`);
      });
    });
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}
export {
  server_default as default
};
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
//# sourceMappingURL=server.js.map

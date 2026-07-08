/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { 
  dbFindUserByEmail, 
  dbCreateUser, 
  dbUpdateUserCourses, 
  getDBStatus, 
  getDb,
  dbGetAllUsers,
  dbSaveUser,
  dbDeleteUser,
  dbGetCourses,
  dbAddCourse,
  dbDeleteCourse,
  dbUpdateCourse,
  dbGetCoupons,
  dbAddCoupon,
  dbToggleCoupon,
  dbDeleteCoupon
} from './src/server/mongodb';
import { COURSES } from './src/data';

const app = express();

app.use(express.json());

  // Trigger MongoDB lazy connection
  getDb().catch(err => {
    console.warn("Initial MongoDB connection attempt deferred or failed:", err.message);
  });

  // ==========================================
  // API ROUTES
  // ==========================================

  // 1. Health & Database Status
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/api/db-status', (req, res) => {
    res.json(getDBStatus());
  });

  // ==========================================
  // AUTHENTICATION & ENROLLMENT ENDPOINTS
  // ==========================================

  // Register
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { name, email, phone, password } = req.body;
      if (!name || !email) {
        return res.status(400).json({ error: 'Name and email are required fields.' });
      }

      const existingUser = await dbFindUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ error: 'An account with this email address already exists.' });
      }

      const newUser = {
        id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: (phone || '').trim(),
        password: password || 'Welcome123',
        enrolledCourses: [],
        createdAt: new Date().toISOString(),
      };

      const created = await dbCreateUser(newUser);
      // Remove password for security in response
      const { password: _, ...safeUser } = created;
      res.status(201).json({ user: safeUser });
    } catch (err) {
      console.error("Register endpoint error:", err);
      res.status(500).json({ error: err.message || 'Server error during registration.' });
    }
  });

  // Login
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
      }

      const user = await dbFindUserByEmail(email);
      if (!user) {
        return res.status(404).json({ error: 'No account found with this email address.' });
      }

      if (user.password !== password) {
        return res.status(401).json({ error: 'Incorrect password. Please try again.' });
      }

      const { password: _, ...safeUser } = user;
      res.json({ user: safeUser });
    } catch (err) {
      console.error("Login endpoint error:", err);
      res.status(500).json({ error: err.message || 'Server error during login.' });
    }
  });

  // Auto Enroll / Course Checkout
  app.post('/api/auth/enroll', async (req, res) => {
    try {
      const { name, email, phone, courseId } = req.body;
      if (!name || !email || !courseId) {
        return res.status(400).json({ error: 'Name, email, and course ID are required.' });
      }

      const existingUser = await dbFindUserByEmail(email);
      let user = existingUser;
      let isNew = false;
      let autoPassword = '';

      if (!user) {
        autoPassword = `Apex@${Math.floor(1000 + Math.random() * 9000)}`;
        const newUser = {
          id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: name.trim(),
          email: email.trim().toLowerCase(),
          phone: (phone || '').trim(),
          password: autoPassword,
          enrolledCourses: [courseId],
          createdAt: new Date().toISOString(),
        };
        user = await dbCreateUser(newUser);
        isNew = true;
      } else {
        // Append course to enrolled courses if not already enrolled
        const updatedCourses = user.enrolledCourses.includes(courseId)
          ? user.enrolledCourses
          : [...user.enrolledCourses, courseId];
        
        user = await dbUpdateUserCourses(
          user.id, 
          updatedCourses, 
          (phone || '').trim() || user.phone, 
          name.trim() || user.name
        );
      }

      if (!user) {
        return res.status(500).json({ error: 'Failed to find or update student account.' });
      }

      const { password: _, ...safeUser } = user;
      res.json({
        user: safeUser,
        isNew,
        autoPassword: isNew ? autoPassword : undefined,
      });
    } catch (err) {
      console.error("Enroll endpoint error:", err);
      res.status(500).json({ error: err.message || 'Server error during enrollment.' });
    }
  });

  // ==========================================
  // COURSES MANAGEMENT API
  // ==========================================
  app.get('/api/courses', async (req, res) => {
    try {
      const courses = await dbGetCourses(COURSES);
      res.json(courses);
    } catch (err) {
      res.status(500).json({ error: err.message || 'Failed to fetch courses.' });
    }
  });

  app.post('/api/courses', async (req, res) => {
    try {
      const { importUrl, title, category, tag, price, lessons, hours, image, description } = req.body;

      // Handle Course Upload using URL link (Import from remote JSON list)
      if (importUrl) {
        try {
          console.log(`Attempting to import courses from URL: ${importUrl}`);
          const fetchRes = await fetch(importUrl);
          if (!fetchRes.ok) {
            throw new Error(`Remote server responded with status ${fetchRes.status}`);
          }
          const data = await fetchRes.json();
          const importedCourses = [];
          
          // Helper to process a course object
          const processCourseObj = async (item) => {
            const id = item.id || `course_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
            const cleanCourse = {
              id,
              title: item.title || 'Untitled Dynamic Course',
              category: item.category || 'it-software',
              tag: item.tag || 'New',
              price: Number(item.price) || 0,
              rating: Number(item.rating) || 5.0,
              reviewCount: Number(item.reviewCount) || 1,
              lessons: Number(item.lessons) || 10,
              hours: Number(item.hours) || 2,
              image: item.image || '/assets/images/photoshop_training_course_1782236638058.jpg',
              description: item.description || ''
            };
            await dbAddCourse(cleanCourse);
            importedCourses.push(cleanCourse);
          };

          if (Array.isArray(data)) {
            for (const item of data) {
              await processCourseObj(item);
            }
          } else if (typeof data === 'object' && data !== null) {
            await processCourseObj(data);
          } else {
            return res.status(400).json({ error: 'URL did not return a valid course array or object.' });
          }

          return res.status(201).json({ message: `Successfully imported ${importedCourses.length} course(s).`, courses: importedCourses });
        } catch (fetchErr) {
          return res.status(400).json({ error: `Failed to download or parse course data from URL link: ${fetchErr.message}` });
        }
      }

      // Handle Manual Course Creation (with details containing image URL link)
      if (!title || !category) {
        return res.status(400).json({ error: 'Title and category are required.' });
      }

      const newCourse = {
        id: `course_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        title,
        category,
        tag: tag || 'General',
        price: Number(price) || 0,
        rating: 5.0,
        reviewCount: 1,
        lessons: Number(lessons) || 12,
        hours: Number(hours) || 4,
        image: image || '/assets/images/photoshop_training_course_1782236638058.jpg',
        description: description || ''
      };

      const added = await dbAddCourse(newCourse);
      res.status(201).json(added);
    } catch (err) {
      console.error("Add course error:", err);
      res.status(500).json({ error: err.message || 'Server error creating course.' });
    }
  });

  app.delete('/api/courses/:id', async (req, res) => {
    try {
      const deleted = await dbDeleteCourse(req.params.id);
      res.json({ success: deleted });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Server error deleting course.' });
    }
  });

  app.put('/api/courses/:id', async (req, res) => {
    try {
      const { title, category, tag, price, lessons, hours, image, description, videoUrl, lessonsList } = req.body;
      const updateFields = {};
      if (title !== undefined) updateFields.title = title;
      if (category !== undefined) updateFields.category = category;
      if (tag !== undefined) updateFields.tag = tag;
      if (price !== undefined) updateFields.price = Number(price);
      if (lessons !== undefined) updateFields.lessons = Number(lessons);
      if (hours !== undefined) updateFields.hours = Number(hours);
      if (image !== undefined) updateFields.image = image;
      if (description !== undefined) updateFields.description = description;
      if (videoUrl !== undefined) updateFields.videoUrl = videoUrl;
      if (lessonsList !== undefined) updateFields.lessonsList = lessonsList;

      const updated = await dbUpdateCourse(req.params.id, updateFields);
      if (!updated) {
        return res.status(404).json({ error: 'Course not found.' });
      }
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message || 'Server error updating course.' });
    }
  });

  // ==========================================
  // COUPONS MANAGEMENT API
  // ==========================================
  app.get('/api/coupons', async (req, res) => {
    try {
      const coupons = await dbGetCoupons();
      res.json(coupons);
    } catch (err) {
      res.status(500).json({ error: err.message || 'Failed to fetch coupons.' });
    }
  });

  app.post('/api/coupons', async (req, res) => {
    try {
      const { code, discountType, discountValue } = req.body;
      if (!code || !discountType || discountValue === undefined) {
        return res.status(400).json({ error: 'Code, discount type, and value are required.' });
      }

      const newCoupon = {
        id: `coupon_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        code: code.trim().toUpperCase(),
        discountType,
        discountValue: Number(discountValue),
        isActive: true,
        createdAt: new Date().toISOString(),
      };

      const added = await dbAddCoupon(newCoupon);
      res.status(201).json(added);
    } catch (err) {
      res.status(500).json({ error: err.message || 'Server error creating coupon.' });
    }
  });

  app.post('/api/coupons/toggle', async (req, res) => {
    try {
      const { id, isActive } = req.body;
      const updated = await dbToggleCoupon(id, isActive);
      res.json({ success: updated });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Server error toggling coupon.' });
    }
  });

  app.delete('/api/coupons/:id', async (req, res) => {
    try {
      const deleted = await dbDeleteCoupon(req.params.id);
      res.json({ success: deleted });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Server error deleting coupon.' });
    }
  });

  // Validate coupon (public endpoint)
  app.post('/api/coupons/validate', async (req, res) => {
    try {
      const { code } = req.body;
      if (!code) {
        return res.status(400).json({ error: 'Coupon code is required.' });
      }

      const coupons = await dbGetCoupons();
      const match = coupons.find(c => c.code === code.trim().toUpperCase());

      if (!match) {
        return res.status(404).json({ error: 'Invalid coupon code.' });
      }
      if (!match.isActive) {
        return res.status(400).json({ error: 'This coupon is no longer active.' });
      }

      res.json(match);
    } catch (err) {
      res.status(500).json({ error: err.message || 'Server error validating coupon.' });
    }
  });

  // ==========================================
  // USER MANAGEMENT API (ADMIN ACTIONS)
  // ==========================================
  app.get('/api/admin/users', async (req, res) => {
    try {
      const users = await dbGetAllUsers();
      // Mask passwords for safety, but return the rest
      const safeUsers = users.map(u => {
        const { password, ...safe } = u;
        return { ...safe, hasPassword: !!password };
      });
      res.json(safeUsers);
    } catch (err) {
      res.status(500).json({ error: err.message || 'Failed to fetch users list.' });
    }
  });

  app.post('/api/admin/users/save', async (req, res) => {
    try {
      const { id, name, email, phone, enrolledCourses, isAdmin, password } = req.body;
      if (!name || !email) {
        return res.status(400).json({ error: 'Name and email are required.' });
      }

      let userToSave;
      if (id) {
        // Edit existing user
        const allUsers = await dbGetAllUsers();
        const existing = allUsers.find(u => u.id === id);
        if (!existing) {
          return res.status(404).json({ error: 'User not found.' });
        }
        userToSave = {
          ...existing,
          name: name.trim(),
          email: email.trim().toLowerCase(),
          phone: (phone || '').trim(),
          enrolledCourses: enrolledCourses || existing.enrolledCourses,
          isAdmin: isAdmin !== undefined ? isAdmin : existing.isAdmin,
        };
        if (password) {
          userToSave.password = password;
        }
      } else {
        // Create new user
        const existing = await dbFindUserByEmail(email);
        if (existing) {
          return res.status(400).json({ error: 'Email already registered.' });
        }
        userToSave = {
          id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          name: name.trim(),
          email: email.trim().toLowerCase(),
          phone: (phone || '').trim(),
          password: password || 'Welcome123',
          enrolledCourses: enrolledCourses || [],
          isAdmin: !!isAdmin,
          createdAt: new Date().toISOString(),
        };
      }

      const saved = await dbSaveUser(userToSave);
      const { password: _, ...safeUser } = saved;
      res.json(safeUser);
    } catch (err) {
      console.error("Save user error:", err);
      res.status(500).json({ error: err.message || 'Server error saving user details.' });
    }
  });

  app.delete('/api/admin/users/:id', async (req, res) => {
    try {
      const deleted = await dbDeleteUser(req.params.id);
      res.json({ success: deleted });
    } catch (err) {
      res.status(400).json({ error: err.message || 'Failed to delete student.' });
    }
  });

  app.post('/api/admin/users/enroll', async (req, res) => {
    try {
      const { userId, enrolledCourses } = req.body;
      if (!userId || !enrolledCourses) {
        return res.status(400).json({ error: 'User ID and enrolledCourses array are required.' });
      }

      const updated = await dbUpdateUserCourses(userId, enrolledCourses);
      if (!updated) {
        return res.status(404).json({ error: 'User not found.' });
      }

      const { password: _, ...safeUser } = updated;
      res.json(safeUser);
    } catch (err) {
      res.status(500).json({ error: err.message || 'Failed to update user enrollment.' });
    }
  });

  // ==========================================
  // VITE / STATIC FILE SERVING & EXPORT
  // ==========================================

  export default app;

  const isVercel = process.env.VERCEL === '1' || !!process.env.NOW_BUILDER;
  if (!isVercel) {
    const PORT = process.env.BACKEND_PORT || process.env.PORT || 3001;
    if (process.env.NODE_ENV !== "production" && !process.env.VITE_STANDALONE) {
      createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      }).then((vite) => {
        app.use(vite.middlewares);
        app.listen(PORT, "0.0.0.0", () => {
          console.log(`Server running on http://localhost:${PORT}`);
        });
      });
    } else {
      const distPath = path.join(process.cwd(), 'dist');
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server running on http://localhost:${PORT}`);
      });
    }
  }

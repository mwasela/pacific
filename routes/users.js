const express = require('express');
const router = express.Router();
const Users = require('../model/Users');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const secretKey = require('../config/secret');
const authenticateToken = require('../middleware/auth');

// User registration
router.post('/register', async (req, res) => {
    const { username, password, role, email, phone_number } = req.body;
    try {
        // Check if user already exists
        const existingUser = await Users.findOne({ where: { username } });
        if (existingUser) {
            return res.status(400).json({ message: 'Username already exists' });
        }
        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);
        // Create new user
        const newUser = await Users.create({
            username,
            password: hashedPassword,
            role,
            email,
            phone_number
        });

        res.status(201).json({ message: 'User registered successfully', user: newUser });
    } catch (error) {
        console.error('Error registering user:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});


// User login
router.post('/login', async (req, res) => {

    const { username, password } = req.body;
    try {
        // Find user by username
        const user = await Users.findOne({ where: { username } });
        if (!user) {
            return res.status(400).json({ message: 'Invalid username or password' });
        }

        //check if user is active
        if (user.status === 1) {
            return res.status(403).json({ message: 'User account is inactive' });
        }

        // Compare password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(400).json({ message: 'Invalid username or password' });
        }

        // Generate JWT token
        const token = jwt.sign({ userId: user.id, role: user.role }, secretKey.secretKey, { expiresIn: '3h' });

        res.json({ message: 'Login successful', token });
    } catch (error) {
        console.error('Error logging in:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});


//current user info
router.get('/me', authenticateToken, async (req, res) => {

    const userId = req.user.userId;
    try {
        const user = await Users.findByPk(userId, {
            attributes: { exclude: ['password'] }
        });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json(user);
    } catch (error) {
        console.error('Error fetching user info:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});


//edit user info
router.put('/:id', authenticateToken, async (req, res) => {
    const userId = req.params.id;
    const { email, phone_number, status, role, username } = req.body;

    try {
        const user = await Users.findByPk(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        user.email = email;
        user.phone_number = phone_number;
        user.status = status;
        user.role = role;
        user.username = username;
        await user.save();

        res.json({ message: 'User updated successfully', user });
    } catch (error) {
        console.error('Error updating user info:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

//get all users
router.get('/', authenticateToken, async (req, res) => {
    try {
        const users = await Users.findAll({
            attributes: { exclude: ['password'] }
        });
        res.json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});


module.exports = router;

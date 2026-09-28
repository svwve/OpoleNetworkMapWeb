package com.example.backend;

import com.example.model.User;
import com.example.model.Role;
import com.example.repository.UserRepository;
import org.mindrot.jbcrypt.BCrypt;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Optional;

@Service
public class UserService {

    private static final Logger logger = LoggerFactory.getLogger(UserService.class);
    private final UserRepository userRepository;

    @Autowired
    public UserService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    public User authenticate(String username, String password) {
        if (username == null || username.trim().isEmpty() || !isUsablePassword(password)) {
            return null;
        }

        Optional<User> userOpt = userRepository.findByUsername(username.trim());
        if (userOpt.isPresent()) {
            User user = userOpt.get();
            try {
                if (BCrypt.checkpw(password, user.getPasswordHash())) {
                    return user;
                }
            } catch (IllegalArgumentException exception) {
                logger.warn("Stored password hash is invalid for user '{}'", username);
            }
        }
        return null;
    }

    public boolean registerUser(String username, String password, Role role) {
        if (username == null || username.trim().isEmpty() || !isUsablePassword(password) || role == null) {
            return false;
        }

        if (userRepository.findByUsername(username.trim()).isPresent()) {
            return false;
        }

        String hashedPassword = BCrypt.hashpw(password, BCrypt.gensalt());
        User user = new User(username.trim(), hashedPassword, role);

        try {
            userRepository.save(user);
            return true;
        } catch (DataIntegrityViolationException exception) {
            logger.info("User registration rejected by a database constraint for username '{}'", username);
            return false;
        }
    }

    public List<User> getAllUsers() {
        return userRepository.findAll();
    }

    public Optional<User> getUserById(Long id) {
        return userRepository.findById(id);
    }

    public User updateUser(Long id, String newPassword, Role newRole) {
        return userRepository.findById(id).map(user -> {
            if (newPassword != null && !newPassword.trim().isEmpty() && isUsablePassword(newPassword)) {
                user.setPasswordHash(BCrypt.hashpw(newPassword, BCrypt.gensalt()));
            }
            if (newRole != null) {
                user.setRole(newRole);
            }
            return userRepository.save(user);
        }).orElse(null);
    }

    private boolean isUsablePassword(String password) {
        return password != null && !password.trim().isEmpty()
                && password.getBytes(StandardCharsets.UTF_8).length <= 72;
    }

    public boolean deleteUser(Long id) {
        if (userRepository.existsById(id)) {
            userRepository.deleteById(id);
            return true;
        }
        return false;
    }
}

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
import java.util.regex.Pattern;

@Service
public class UserService {

    private static final Logger logger = LoggerFactory.getLogger(UserService.class);
    private static final Pattern BCRYPT_HASH = Pattern.compile("^\\$2[aby]\\$\\d{2}\\$[./A-Za-z0-9]{53}$");
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
                if (user.isApproved() && BCrypt.checkpw(password, user.getPasswordHash())) {
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
        User user = new User(username.trim(), hashedPassword, role, false);

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

    public List<User> getPendingUsers() {
        return userRepository.findByApprovedFalseOrderByUsernameAsc();
    }

    public boolean approveUser(Long id) {
        return userRepository.findById(id).map(user -> {
            user.setApproved(true);
            userRepository.save(user);
            return true;
        }).orElse(false);
    }

    public boolean isValidSession(String username, Object userId, Object role) {
        if (username == null || !(userId instanceof Number id) || !(role instanceof String roleName)) {
            return false;
        }
        return userRepository.findByUsername(username)
                .filter(User::isApproved)
                .filter(user -> user.getId() != null && user.getId().longValue() == id.longValue())
                .filter(user -> user.getRole() != null && user.getRole().name().equals(roleName))
                .isPresent();
    }

    public void ensureDefaultAdmin() {
        Optional<User> existingAdmin = userRepository.findByUsername("admin");
        if (existingAdmin.isEmpty()) {
            userRepository.save(new User("admin", BCrypt.hashpw("admin", BCrypt.gensalt()), Role.ADMIN, true));
            logger.warn("Created the default administrator account; change its password immediately.");
            return;
        }

        User admin = existingAdmin.get();
        boolean changed = false;
        if (!BCRYPT_HASH.matcher(admin.getPasswordHash()).matches()) {
            admin.setPasswordHash(BCrypt.hashpw("admin", BCrypt.gensalt()));
            changed = true;
            logger.warn("Replaced a non-BCrypt password for the default administrator; change it immediately.");
        }
        if (admin.getRole() != Role.ADMIN) {
            admin.setRole(Role.ADMIN);
            changed = true;
        }
        if (!admin.isApproved()) {
            admin.setApproved(true);
            changed = true;
        }
        if (changed) {
            userRepository.save(admin);
        }
    }

    public Optional<User> getUserById(Long id) {
        return userRepository.findById(id);
    }

    public User updateUser(Long id, String newPassword, Role newRole) {
        return userRepository.findById(id).map(user -> {
            if (newPassword != null && !newPassword.trim().isEmpty() && isUsablePassword(newPassword)) {
                user.setPasswordHash(BCrypt.hashpw(newPassword, BCrypt.gensalt()));
            }
            if (newRole != null && !"admin".equals(user.getUsername())) {
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
        Optional<User> user = userRepository.findById(id);
        if (user.isPresent() && !"admin".equals(user.get().getUsername())) {
            userRepository.deleteById(id);
            return true;
        }
        return false;
    }
}

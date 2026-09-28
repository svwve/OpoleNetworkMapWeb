package com.example.backend.controllers;

import com.example.backend.UserService;
import com.example.model.Role;
import com.example.model.User;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import jakarta.validation.Valid;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final UserService userService;

    @Autowired
    public AuthController(UserService userService) {
        this.userService = userService;
    }

    @PostMapping("/login")
    public ResponseEntity<Map<String, Object>> login(
            @Valid @RequestBody AuthRequest credentials, HttpServletRequest request) {
        String username = credentials.username().trim();
        String password = credentials.password();
        if (password.getBytes(StandardCharsets.UTF_8).length > 72) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false, "message", "Hasło może mieć maksymalnie 72 bajty UTF-8."
            ));
        }

        User user = userService.authenticate(username, password);

        Map<String, Object> response = new HashMap<>();
        if (user != null) {
            Role role = user.getRole();
            HttpSession session = request.getSession(true);
            request.changeSessionId();
            session.setAttribute("username", username);
            session.setAttribute("role", role.name());
            session.setAttribute("userId", Math.toIntExact(user.getId()));
            response.put("success", true);
            response.put("role", role.name());
            response.put("username", username);
            return ResponseEntity.ok(response);
        } else {
            response.put("success", false);
            response.put("message", "Nieprawidłowy login lub hasło");
            return ResponseEntity.status(401).body(response);
        }
    }

    @PostMapping("/register")
    public ResponseEntity<Map<String, Object>> register(@Valid @RequestBody RegisterRequest request) {
        if (request.password().getBytes(StandardCharsets.UTF_8).length > 72) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false, "message", "Hasło może mieć maksymalnie 72 bajty UTF-8."
            ));
        }
        boolean registered = userService.registerUser(
                request.username().trim(), request.password(), Role.OPERATOR);

        Map<String, Object> response = new HashMap<>();
        if (registered) {
            response.put("success", true);
            response.put("message", "Zarejestrowano pomyślnie");
            return ResponseEntity.ok(response);
        } else {
            response.put("success", false);
            response.put("message", "Użytkownik już istnieje lub wystąpił błąd");
            return ResponseEntity.badRequest().body(response);
        }
    }

    @PostMapping("/logout")
    public ResponseEntity<Map<String, Object>> logout(HttpSession session) {
        session.invalidate();
        return ResponseEntity.ok(Map.of("success", true));
    }
}

package com.example.backend.controllers;

import com.example.backend.UserService;
import com.example.model.Role;
import com.example.model.User;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserService userService;

    @Autowired
    public UserController(UserService userService) {
        this.userService = userService;
    }

    @GetMapping
    public ResponseEntity<List<Map<String, Object>>> getAllUsers() {
        // Return users without password hashes
        List<Map<String, Object>> users = userService.getAllUsers().stream()
            .map(user -> {
                Map<String, Object> map = new java.util.HashMap<>();
                map.put("id", user.getId());
                map.put("username", user.getUsername());
                map.put("role", user.getRole().name());
                return map;
            })
            .collect(Collectors.toList());
        return ResponseEntity.ok(users);
    }

    @GetMapping("/{id}")
    public ResponseEntity<Map<String, Object>> getUserById(@PathVariable Long id) {
        return userService.getUserById(id).map(user -> ResponseEntity.ok(Map.of(
            "id", (Object) user.getId(),
            "username", (Object) user.getUsername(),
            "role", (Object) user.getRole().name()
        ))).orElse(ResponseEntity.notFound().build());
    }

    @PutMapping("/{id}")
    public ResponseEntity<Map<String, Object>> updateUser(
            @PathVariable Long id, @Valid @RequestBody UserUpdateRequest request) {
        String newPassword = request.password();
        if (newPassword != null && newPassword.getBytes(StandardCharsets.UTF_8).length > 72) {
            return ResponseEntity.badRequest().body(Map.of("error", "Hasło może mieć maksymalnie 72 bajty UTF-8."));
        }
        Role newRole = null;
        if (request.role() != null) {
            newRole = Role.valueOf(request.role());
        }
        
        User updated = userService.updateUser(id, newPassword, newRole);
        if (updated != null) {
            return ResponseEntity.ok(Map.of(
                "id", (Object) updated.getId(),
                "username", (Object) updated.getUsername(),
                "role", (Object) updated.getRole().name()
            ));
        }
        return ResponseEntity.notFound().build();
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteUser(@PathVariable Long id) {
        if (userService.deleteUser(id)) {
            return ResponseEntity.ok(Map.of("success", true));
        }
        return ResponseEntity.notFound().build();
    }
}
